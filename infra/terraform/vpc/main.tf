# ============================================================
# VPC — network foundation for all other modules.
#
# Layout (per AZ):
#   public  subnet → ALB (internet-facing), NAT Gateway EIP
#   private subnet → EKS nodes, RDS, ElastiCache (no direct internet)
#
# NAT Gateway: single for dev (cheaper), one-per-AZ for prod (HA).
#
# VPC Endpoints reduce NAT traffic for ECR pulls and S3 access —
# EKS image pulls go directly over the AWS backbone instead of
# routing out through the NAT Gateway and back.
#
# Verification after apply:
#   terraform output -json | jq '{vpc_id, private_subnet_ids, public_subnet_ids}'
#   aws ec2 describe-vpcs --vpc-ids <vpc_id> --query 'Vpcs[0].State'
#   # Should return "available"
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
      Environment = var.environment
      Project     = var.project
      ManagedBy   = "terraform"
    }
  }
}

# ---- VPC ----------------------------------------------------------------
# The community VPC module handles subnets, route tables, IGW, NAT, and
# the EKS-required subnet tags in ~30 lines instead of ~300.

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${var.project}-${var.environment}"
  cidr = var.vpc_cidr

  azs             = var.availability_zones
  public_subnets  = var.public_subnet_cidrs
  private_subnets = var.private_subnet_cidrs

  # NAT Gateway configuration
  enable_nat_gateway     = true
  single_nat_gateway     = var.single_nat_gateway  # false = one per AZ (prod HA)
  one_nat_gateway_per_az = !var.single_nat_gateway

  # DNS — required for EKS and VPC endpoints to resolve service hostnames
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags required by the AWS Load Balancer Controller to discover subnets
  public_subnet_tags = {
    "kubernetes.io/role/elb"                        = "1"
    "kubernetes.io/cluster/${var.project}-${var.environment}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"               = "1"
    "kubernetes.io/cluster/${var.project}-${var.environment}" = "shared"
  }
}

# ---- VPC Endpoints -------------------------------------------------------
# Route ECR pulls and S3 access through the AWS backbone instead of NAT.
# At scale this saves meaningful NAT data-processing costs (EKS image pulls
# can be hundreds of GB/month without endpoints).

# S3 Gateway endpoint — free, no data charges
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
}

# ECR API interface endpoint — ECR auth calls
resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}

# ECR Docker endpoint — image layer pulls
resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}

# Secrets Manager endpoint — so pods can fetch secrets without leaving the VPC
resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = module.vpc.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = module.vpc.private_subnets
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}

# ---- Security group for interface VPC endpoints -------------------------
resource "aws_security_group" "vpc_endpoints" {
  name        = "${var.project}-${var.environment}-vpc-endpoints"
  description = "Allow HTTPS from within the VPC to interface endpoints"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTPS from VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  # No egress rule needed — endpoints are the destination, not the source
}
