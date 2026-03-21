# These outputs are consumed by downstream modules (eks, rds, elasticache)
# via terraform_remote_state data sources.

output "vpc_id" {
  description = "The VPC ID"
  value       = module.vpc.vpc_id
}

output "vpc_cidr" {
  description = "The VPC CIDR block"
  value       = module.vpc.vpc_cidr_block
}

output "private_subnet_ids" {
  description = "Private subnet IDs (EKS nodes, RDS, ElastiCache)"
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB)"
  value       = module.vpc.public_subnets
}

output "private_subnet_cidr_blocks" {
  description = "CIDR blocks for private subnets — used in RDS/ElastiCache security groups"
  value       = module.vpc.private_subnets_cidr_blocks
}

output "availability_zones" {
  description = "AZs used by the VPC subnets"
  value       = module.vpc.azs
}
