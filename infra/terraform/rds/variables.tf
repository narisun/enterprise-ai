variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: dev | staging | prod"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where RDS is deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks permitted to connect on port 5432 (EKS node subnets)"
  type        = list(string)
}

variable "db_password_secret_arn" {
  description = "ARN of the AWS Secrets Manager secret containing the DB master password"
  type        = string
  sensitive   = true
}

variable "instance_class" {
  description = "RDS instance type"
  type        = string
  default     = "db.t4g.medium"
}

variable "allocated_storage" {
  description = "Initial storage in GB"
  type        = number
  default     = 50
}

variable "max_allocated_storage" {
  description = "Maximum auto-scaled storage in GB"
  type        = number
  default     = 100
}

# Production-safe defaults (false = take a snapshot on destroy, true = HA)
variable "skip_final_snapshot" {
  description = "Skip final snapshot on destroy. Set true ONLY for dev."
  type        = bool
  default     = false
}

variable "multi_az" {
  description = "Enable Multi-AZ for high availability. Set false ONLY for dev."
  type        = bool
  default     = true
}
