# ============================================================
# IAM — GitHub OIDC trust, CI deploy role, and IRSA roles.
#
# Apply TWICE:
#   Pass 1: before EKS exists — creates GitHub OIDC + deploy role
#   Pass 2: after EKS exists  — fill in eks_oidc_provider_url/arn to
#           create the IRSA roles that EKS service accounts can assume
#
# Verification after Pass 1:
#   aws iam get-open-id-connect-provider \
#     --open-id-connect-provider-arn $(terraform output -raw github_oidc_provider_arn)
#   # Trigger a GitHub Actions workflow — it should assume the deploy role
#   # and print the caller identity:
#   #   aws sts get-caller-identity
#
# Verification after Pass 2:
#   terraform output -json irsa_role_arns
#   # Annotate the Kubernetes service accounts with these ARNs, then
#   # exec into a pod and run:
#   #   aws sts get-caller-identity  →  should show the IRSA role
# ============================================================

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
}

# ============================================================
# PART 1: GitHub Actions OIDC — keyless CI auth
# ============================================================

# The OIDC provider is a global resource (one per AWS account).
# If it already exists, import it:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com
resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # Thumbprint list — GitHub rotates these rarely; pin the current value.
  # To refresh: openssl s_client -connect token.actions.githubusercontent.com:443 \
  #   < /dev/null 2>/dev/null | openssl x509 -fingerprint -noout -sha1 | \
  #   tr -d ':' | tr '[:upper:]' '[:lower:]' | cut -d= -f2
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1",
                     "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

# ---- Deploy role — assumed by GitHub Actions CI --------------------------

data "aws_iam_policy_document" "github_oidc_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Allow any branch/tag/PR in the repo — narrow to specific branches if preferred
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for b in var.deploy_branches : "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${b}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_trust.json
  description        = "Assumed by GitHub Actions CI via OIDC - ECR push + EKS deploy"
}

# ECR push permissions
data "aws_iam_policy_document" "ecr_push" {
  statement {
    sid    = "ECRAuth"
    effect = "Allow"
    actions = ["ecr:GetAuthorizationToken"]
    resources = ["*"]  # GetAuthorizationToken is not resource-scoped
  }

  statement {
    sid    = "ECRPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
    ]
    resources = [
      "arn:${local.partition}:ecr:${var.aws_region}:${local.account_id}:repository/${var.project}/*"
    ]
  }
}

# EKS kubeconfig permissions — only describe, never modify cluster config
data "aws_iam_policy_document" "eks_deploy" {
  statement {
    sid     = "EKSDescribe"
    effect  = "Allow"
    actions = ["eks:DescribeCluster", "eks:ListClusters"]
    resources = [
      "arn:${local.partition}:eks:${var.aws_region}:${local.account_id}:cluster/${var.project}-*"
    ]
  }
}

resource "aws_iam_role_policy" "github_deploy_ecr" {
  name   = "ecr-push"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.ecr_push.json
}

resource "aws_iam_role_policy" "github_deploy_eks" {
  name   = "eks-describe"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.eks_deploy.json
}

# ============================================================
# PART 2: IRSA roles — for EKS pods that call AWS services
# Created only when eks_oidc_provider_arn is provided.
# ============================================================

# ---- External Secrets Operator — reads Secrets Manager ------------------
resource "aws_iam_role" "external_secrets" {
  count = var.eks_oidc_provider_arn != "" ? 1 : 0

  name        = "${var.project}-external-secrets-irsa"
  description = "Assumed by External Secrets Operator to read AWS Secrets Manager"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.eks_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.eks_oidc_provider_url}:aud" = "sts.amazonaws.com"
          "${var.eks_oidc_provider_url}:sub" = "system:serviceaccount:external-secrets:external-secrets"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "external_secrets" {
  count = var.eks_oidc_provider_arn != "" ? 1 : 0
  name  = "secrets-manager-read"
  role  = aws_iam_role.external_secrets[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets",
        ]
        Resource = "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:${var.project}/*"
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = "*"   # Narrow to specific KMS key ARN after infra is built
      }
    ]
  })
}

# ---- LiteLLM — Amazon Bedrock access -------------------------------------
# The litellm Helm template already references serviceAccountName: litellm-bedrock-irsa
resource "aws_iam_role" "litellm_bedrock" {
  count = var.eks_oidc_provider_arn != "" ? 1 : 0

  name        = "${var.project}-litellm-bedrock-irsa"
  description = "Assumed by LiteLLM proxy pods to call Amazon Bedrock"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.eks_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.eks_oidc_provider_url}:aud" = "sts.amazonaws.com"
          "${var.eks_oidc_provider_url}:sub" = "system:serviceaccount:ai-platform:litellm-bedrock-irsa"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "litellm_bedrock" {
  count = var.eks_oidc_provider_arn != "" ? 1 : 0
  name  = "bedrock-invoke"
  role  = aws_iam_role.litellm_bedrock[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "BedrockInvoke"
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = "arn:${local.partition}:bedrock:${var.aws_region}::foundation-model/*"
    }]
  })
}
