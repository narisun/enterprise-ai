output "repository_urls" {
  description = "Map of service name → ECR repository URL"
  value       = { for k, v in aws_ecr_repository.services : k => v.repository_url }
}

output "registry_id" {
  description = "AWS account ID (the ECR registry ID) — identical across all repos in the same account"
  value       = values(aws_ecr_repository.services)[0].registry_id
}

# Convenience outputs used directly in ci-deploy.yml
output "ai_agents_repository_url" {
  value = aws_ecr_repository.services["ai-agents"].repository_url
}

output "rm_prep_agent_repository_url" {
  value = aws_ecr_repository.services["rm-prep-agent"].repository_url
}

output "data_mcp_repository_url" {
  value = aws_ecr_repository.services["data-mcp"].repository_url
}
