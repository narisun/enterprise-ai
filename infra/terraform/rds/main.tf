terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---- KMS key for storage encryption ----------------------------------------
resource "aws_kms_key" "rds_key" {
  description         = "KMS key for AI Platform RDS encryption"
  enable_key_rotation = true
  tags                = local.common_tags
}

# ---- DB Subnet Group --------------------------------------------------------
resource "aws_db_subnet_group" "ai_memory" {
  name       = "ai-memory-subnet-group-${var.environment}"
  subnet_ids = var.private_subnet_ids
  tags       = local.common_tags
}

# ---- Security Group ---------------------------------------------------------
resource "aws_security_group" "rds_sg" {
  name        = "ai-memory-rds-sg-${var.environment}"
  description = "Allow PostgreSQL from EKS node subnets only"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from internal VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  # M9: RDS instances never initiate outbound connections — no egress rule needed.
  # AWS security groups are stateful: responses to allowed inbound connections
  # are permitted automatically without an explicit egress rule.

  tags = local.common_tags
}

# ---- Parameter group (pgvector) --------------------------------------------
resource "aws_db_parameter_group" "pgvector" {
  name   = "ai-memory-pg16-${var.environment}"
  family = "postgres16"

  parameter {
    name         = "shared_preload_libraries"
    value        = "vector"
    apply_method = "pending-reboot"
  }

  tags = local.common_tags
}

# ---- RDS Password from Secrets Manager (never from CLI) --------------------
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = var.db_password_secret_arn
}

# ---- RDS Instance ----------------------------------------------------------
resource "aws_db_instance" "ai_memory" {
  identifier     = "ai-memory-pg-${var.environment}"
  engine         = "postgres"
  engine_version = "16.3"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds_key.arn

  db_name  = "ai_memory"
  username = "dbadmin"
  # M10: If the secret is stored as a JSON object (e.g. {"password":"..."})
  # use jsondecode to extract just the password value:
  #   password = jsondecode(data.aws_secretsmanager_secret_version.db_password.secret_string)["password"]
  # If the secret is a plain string, use secret_string directly as below.
  # Document the expected format in variables.tf so future engineers don't guess.
  password = data.aws_secretsmanager_secret_version.db_password.secret_string

  db_subnet_group_name   = aws_db_subnet_group.ai_memory.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  parameter_group_name   = aws_db_parameter_group.pgvector.name

  # Production-safe defaults — override in dev.tfvars
  skip_final_snapshot = var.skip_final_snapshot   # default: false (prod-safe)
  multi_az            = var.multi_az              # default: true  (prod-safe)
  publicly_accessible = false

  tags = local.common_tags
}

# ---- Common tags -----------------------------------------------------------
locals {
  common_tags = {
    Environment = var.environment
    Project     = "enterprise-ai"
    ManagedBy   = "terraform"
  }
}
