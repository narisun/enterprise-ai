output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
}

output "cluster_version" {
  description = "Kubernetes version running on the cluster"
  value       = module.eks.cluster_version
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN — supply to infra/terraform/iam/ for IRSA roles"
  value       = module.eks.oidc_provider_arn
}

output "oidc_provider_url" {
  description = "OIDC provider URL (without https://) — supply to infra/terraform/iam/"
  value       = module.eks.oidc_provider
}

output "node_group_arn" {
  description = "Managed node group ARN"
  value       = module.eks.eks_managed_node_groups["default"].node_group_arn
}

output "configure_kubectl" {
  description = "Command to configure local kubectl"
  value       = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.aws_region}"
}
