variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: dev | staging | prod"
  type        = string
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "enterprise-ai"
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t4g.small"
}

variable "num_cache_nodes" {
  description = "Number of cache nodes (1 for dev, 2+ for prod)"
  type        = number
  default     = 1
}

variable "automatic_failover_enabled" {
  description = "Enable multi-AZ automatic failover (requires num_cache_nodes > 1)"
  type        = bool
  default     = false
}

variable "redis_password_secret_arn" {
  description = "ARN of the AWS Secrets Manager secret containing the Redis auth token"
  type        = string
  sensitive   = true
}

variable "tf_state_bucket" {
  description = "S3 bucket name used for Terraform remote state (output of tf-bootstrap)"
  type        = string
}
