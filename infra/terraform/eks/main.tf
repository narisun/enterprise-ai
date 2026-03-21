# ============================================================
# EKS — Kubernetes cluster with managed node group.
#
# VPC inputs are read from the vpc module's remote state —
# no manual copy-paste of subnet IDs required.
#
# Add-ons installed here:
#   - vpc-cni, coredns, kube-proxy  (core networking/DNS)
#   - aws-ebs-csi-driver            (PersistentVolumes)
#   - AWS Load Balancer Controller  (via Helm, not add-on API)
#
# Verification after apply:
#   aws eks update-kubeconfig --name enterprise-ai-<env> --region <region>
#   kubectl get nodes -o wide            # should show Ready nodes
#   kubectl get pods -n kube-system      # all pods Running
#   kubectl get pods -n kube-system | grep aws-load-balancer  # LBC Running
# ============================================================

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.29"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Environment = var.environment
      Project     = var.project
      ManagedBy   = "terraform"
    }
  }
}

# ---- Pull VPC outputs from remote state ---------------------------------
data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket = var.tf_state_bucket
    key    = "vpc/terraform.tfstate"
    region = var.aws_region
  }
}

locals {
  cluster_name     = "${var.project}-${var.environment}"
  vpc_id           = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnets  = data.terraform_remote_state.vpc.outputs.private_subnet_ids
}

# ---- EKS Cluster --------------------------------------------------------
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  cluster_name    = local.cluster_name
  cluster_version = var.cluster_version

  vpc_id     = local.vpc_id
  subnet_ids = local.private_subnets

  # Enable OIDC — required for IRSA (IAM Roles for Service Accounts)
  enable_irsa = true

  # Control plane endpoint access — private only in prod
  cluster_endpoint_public_access  = true   # Set false for prod after VPN/bastion is ready
  cluster_endpoint_private_access = true

  # Managed add-ons — use LATEST for initial setup, then pin once stable
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent              = true
      before_compute           = true    # Must be ready before nodes join
      configuration_values     = jsonencode({
        env = {
          # Warm pool: keep 2 IPs pre-allocated per node for faster pod startup
          WARM_ENI_TARGET = "2"
        }
      })
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = module.ebs_csi_irsa.iam_role_arn
    }
  }

  # Managed node group
  eks_managed_node_groups = {
    default = {
      name            = "nodes"
      instance_types  = var.node_instance_types
      min_size        = var.node_min_size
      max_size        = var.node_max_size
      desired_size    = var.node_desired_size
      disk_size       = var.node_disk_size_gb

      # Launch on private subnets only — nodes have no public IPs
      subnet_ids = local.private_subnets

      labels = {
        role = "application"
      }
    }
  }

  # Allow kubectl access from the Terraform executor's IAM identity
  enable_cluster_creator_admin_permissions = true
}

# ---- IRSA for EBS CSI driver -----------------------------------------
module "ebs_csi_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.39"

  role_name             = "${local.cluster_name}-ebs-csi"
  attach_ebs_csi_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}

# ---- AWS Load Balancer Controller (Helm) ----------------------------
# Deployed as a Helm release so it can be upgraded independently of the
# EKS cluster add-on cycle.

module "aws_lbc_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.39"

  role_name                              = "${local.cluster_name}-aws-lbc"
  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", local.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", local.cluster_name]
    }
  }
}

resource "kubernetes_service_account" "aws_lbc" {
  metadata {
    name      = "aws-load-balancer-controller"
    namespace = "kube-system"
    annotations = {
      "eks.amazonaws.com/role-arn" = module.aws_lbc_irsa.iam_role_arn
    }
  }
  depends_on = [module.eks]
}

resource "helm_release" "aws_lbc" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"
  version    = "1.7.2"   # Pin — check https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases

  set {
    name  = "clusterName"
    value = local.cluster_name
  }
  set {
    name  = "serviceAccount.create"
    value = "false"   # We created it above with the IRSA annotation
  }
  set {
    name  = "serviceAccount.name"
    value = kubernetes_service_account.aws_lbc.metadata[0].name
  }
  set {
    name  = "region"
    value = var.aws_region
  }
  set {
    name  = "vpcId"
    value = local.vpc_id
  }

  depends_on = [kubernetes_service_account.aws_lbc]
}
