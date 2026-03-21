output "redis_endpoint" {
  description = "Redis primary endpoint — use as REDIS_HOST in app config"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.redis.port
}

output "redis_connection_string" {
  description = "Full connection info (password not included)"
  value       = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}
