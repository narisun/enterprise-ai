# ============================================================
# BOOTSTRAP — run ONCE manually before any other Terraform module.
#
# Creates the S3 bucket and DynamoDB table that all other modules
# use as their remote state backend. These resources cannot
# manage themselves, so they are provisioned without a backend block
# and committed directly (no secrets in state — just bucket/table names).
#
# Usage (one-time, from this directory):
#   terraform init
#   terraform apply -var="aws_region=us-east-1"
#
# After apply, verify before proceeding:
#   aws s3 ls | grep enterprise-ai-terraform-state
#   aws dynamodb describe-table --table-name enterprise-ai-terraform-locks \
#     --query 'Table.TableStatus'
# ============================================================

terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # No backend block — bootstrap manages itself locally.
  # Commit the resulting terraform.tfstate to a PRIVATE location (e.g. 1Password
  # secure note) so you can re-run this if the bucket ever needs to be recreated.
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used in resource naming"
  type        = string
  default     = "enterprise-ai"
}

# Appending the account ID makes the bucket name globally unique.
# S3 bucket names are shared across all AWS accounts worldwide —
# a generic name like "enterprise-ai-terraform-state" is often already taken.
data "aws_caller_identity" "current" {}

locals {
  # e.g. enterprise-ai-terraform-state-123456789012
  state_bucket_name = "${var.project}-terraform-state-${data.aws_caller_identity.current.account_id}"
}

# ---- S3 bucket for Terraform state ------------------------------------------

resource "aws_s3_bucket" "tf_state" {
  bucket = local.state_bucket_name

  # Prevent accidental deletion of the bucket that holds all your Terraform state
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Project   = var.project
    ManagedBy = "terraform-bootstrap"
  }
}

resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---- DynamoDB table for state locking ---------------------------------------

resource "aws_dynamodb_table" "tf_locks" {
  name         = "${var.project}-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Project   = var.project
    ManagedBy = "terraform-bootstrap"
  }
}

output "state_bucket" {
  description = "Bucket name to use in all backend.tf files"
  value       = aws_s3_bucket.tf_state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.tf_locks.name
}
