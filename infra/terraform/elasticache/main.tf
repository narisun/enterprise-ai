# ============================================================
# ElastiCache — Redis replacement for the local Redis container.
#
# Mirrors the Docker Compose redis service:
#   - Redis 7.x with requirepass AUTH
#   - In-transit encryption (TLS)
#   - At-rest encryption
#   - Private subnets only — not accessible from the internet
#
# The Redis password is read from Secrets Manager at apply time
# and stored in the ElastiCache auth token — it is NOT in state.
#
# Verification after apply:
#   # From inside an EKS pod (install redis-tools first):
#   kubectl run redis-test --image=redis:7-alpine --rm -it --restart=Never -- \
#     redis-cli -h $(terraform output -raw redis_endpoint) \
#               -p 6379 --tls -a $REDIS_PASSWORD ping
#   # Should respond: PONG
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

# Pull VPC outputs from remote state
data "terraform_remote_state" "vpc" {
  backend = "s3"
  config = {
    bucket = var.tf_state_bucket
    key    = "vpc/terraform.tfstate"
    region = var.aws_region
  }
}

data "aws_secretsmanager_secret_version" "redis_password" {
  secret_id = var.redis_password_secret_arn
}

locals {
  vpc_id          = data.terraform_remote_state.vpc.outputs.vpc_id
  private_subnets = data.terraform_remote_state.vpc.outputs.private_subnet_ids
  vpc_cidr        = data.terraform_remote_state.vpc.outputs.vpc_cidr

  # The secret is stored as a JSON object — extract just the password string.
  # ElastiCache auth_token must be a plain string (16-128 chars, no @, ", or /)
  redis_password = jsondecode(data.aws_secretsmanager_secret_version.redis_password.secret_string)["REDIS_PASSWORD"]
}

# ---- Subnet Group -------------------------------------------------------
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project}-${var.environment}-redis"
  subnet_ids = local.private_subnets
}

# ---- Security Group -----------------------------------------------------
resource "aws_security_group" "redis" {
  name        = "${var.project}-${var.environment}-redis-sg"
  description = "Allow Redis access from EKS nodes only"
  vpc_id      = local.vpc_id

  ingress {
    description = "Redis from VPC private subnets (EKS nodes)"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [local.vpc_cidr]
  }
}

# ---- Parameter Group (Redis 7.x) ----------------------------------------
resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${var.project}-${var.environment}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"   # Evict least-recently-used when memory is full
  }
}

# ---- Replication Group (Redis with optional multi-AZ) -------------------
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.project}-${var.environment}"
  description          = "Redis for ${var.project} ${var.environment}"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_nodes
  port                 = 6379

  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.redis.id]
  parameter_group_name = aws_elasticache_parameter_group.redis7.name

  # Security
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  auth_token                  = local.redis_password

  automatic_failover_enabled   = var.automatic_failover_enabled
  multi_az_enabled             = var.automatic_failover_enabled

  # Maintenance window — off-peak hours
  maintenance_window = "sun:05:00-sun:06:00"
  snapshot_window    = "04:00-05:00"
  snapshot_retention_limit = var.environment == "prod" ? 7 : 1

  apply_immediately = var.environment != "prod"   # Avoid prod change windows for non-urgent updates

  lifecycle {
    ignore_changes = [auth_token]   # Prevent Terraform from cycling the cluster on password rotation
  }
}
