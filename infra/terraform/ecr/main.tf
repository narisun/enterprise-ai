# ============================================================
# ECR — private container registries for all service images.
#
# ECR is global per account/region — no environment suffix needed.
# Images are tagged by git SHA (set by CI). The lifecycle policy
# keeps the last N tagged images and removes untagged layers
# older than 1 day (dangling layers from interrupted pushes).
#
# Verification after apply:
#   aws ecr describe-repositories --query 'repositories[*].repositoryUri'
#   # Push a test image to confirm permissions:
#   aws ecr get-login-password | docker login --username AWS \
#     --password-stdin $(terraform output -raw ai_agents_repository_url | cut -d/ -f1)
#   docker pull alpine:3.19
#   docker tag alpine:3.19 $(terraform output -raw ai_agents_repository_url):smoke
#   docker push $(terraform output -raw ai_agents_repository_url):smoke
#   aws ecr list-images --repository-name enterprise-ai/ai-agents
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

locals {
  # One entry per Dockerfile in the monorepo
  repositories = [
    "ai-agents",
    "rm-prep-agent",
    "data-mcp",
    "payments-mcp",
    "salesforce-mcp",
    "news-search-mcp",
  ]

  lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Remove untagged layers older than 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last ${var.image_retention_count} tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["sha-", "v"]
          countType     = "imageCountMoreThan"
          countNumber   = var.image_retention_count
        }
        action = { type = "expire" }
      }
    ]
  })
}

resource "aws_ecr_repository" "services" {
  for_each = toset(local.repositories)

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"  # SHA tags can never be overwritten

  image_scanning_configuration {
    scan_on_push = true   # Free basic scanning — catches known CVEs on every push
  }

  encryption_configuration {
    encryption_type = "KMS"   # Default KMS key; override with kms_key if needed
  }
}

resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name
  policy     = local.lifecycle_policy
}
