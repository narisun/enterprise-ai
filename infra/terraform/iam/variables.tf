variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used in IAM resource naming"
  type        = string
  default     = "enterprise-ai"
}

variable "github_org" {
  description = "GitHub organization or user name (e.g. 'my-company')"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (e.g. 'enterprise-ai')"
  type        = string
}

variable "deploy_branches" {
  description = "Branch patterns allowed to trigger deploys (e.g. main, release/*)"
  type        = list(string)
  default     = ["main"]
}

# EKS OIDC — filled in after EKS cluster exists.
# Run: terraform output -raw oidc_provider_url  (from infra/terraform/eks/)
variable "eks_oidc_provider_url" {
  description = "EKS cluster OIDC provider URL (without https://). Leave empty before EKS is created."
  type        = string
  default     = ""
}

variable "eks_oidc_provider_arn" {
  description = "EKS cluster OIDC provider ARN. Leave empty before EKS is created."
  type        = string
  default     = ""
}
