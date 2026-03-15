output "rds_endpoint" {
  description = "RDS connection endpoint"
  value       = aws_db_instance.ai_memory.endpoint
}

output "rds_db_name" {
  description = "Database name"
  value       = aws_db_instance.ai_memory.db_name
}

output "rds_port" {
  description = "Database port"
  value       = aws_db_instance.ai_memory.port
}

output "rds_security_group_id" {
  description = "Security group ID for the RDS instance (needed by EKS node groups)"
  value       = aws_security_group.rds_sg.id
}
