output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "github_deploy_role_arn" {
  description = "ARN of the IAM role assumed by GitHub Actions CI — set as AWS_DEPLOY_ROLE_ARN in GitHub vars"
  value       = aws_iam_role.github_deploy.arn
}

output "external_secrets_role_arn" {
  description = "IRSA role ARN for the External Secrets Operator service account"
  value       = length(aws_iam_role.external_secrets) > 0 ? aws_iam_role.external_secrets[0].arn : "not-created-yet"
}

output "litellm_bedrock_role_arn" {
  description = "IRSA role ARN for the LiteLLM Bedrock service account"
  value       = length(aws_iam_role.litellm_bedrock) > 0 ? aws_iam_role.litellm_bedrock[0].arn : "not-created-yet"
}

output "irsa_role_arns" {
  description = "All IRSA role ARNs in one map for reference"
  value = {
    external_secrets = length(aws_iam_role.external_secrets) > 0 ? aws_iam_role.external_secrets[0].arn : null
    litellm_bedrock  = length(aws_iam_role.litellm_bedrock) > 0 ? aws_iam_role.litellm_bedrock[0].arn : null
  }
}
