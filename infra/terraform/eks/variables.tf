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

variable "cluster_version" {
  description = "Kubernetes version. Check EKS release calendar before bumping."
  type        = string
  default     = "1.30"
}

variable "node_instance_types" {
  description = "EC2 instance types for the managed node group"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_min_size" {
  description = "Minimum nodes in the managed node group"
  type        = number
  default     = 1
}

variable "node_max_size" {
  description = "Maximum nodes in the managed node group"
  type        = number
  default     = 4
}

variable "node_desired_size" {
  description = "Desired nodes at launch"
  type        = number
  default     = 2
}

variable "node_disk_size_gb" {
  description = "Root EBS volume size for each node in GB"
  type        = number
  default     = 50
}

variable "tf_state_bucket" {
  description = "S3 bucket name used for Terraform remote state (output of tf-bootstrap)"
  type        = string
}
