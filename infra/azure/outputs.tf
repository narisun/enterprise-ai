# ============================================================
# enterprise-ai — Azure Outputs
# ============================================================

output "vm_public_ip" {
  description = "Public IP of the VM (SSH + LangFuse admin access)"
  value       = azurerm_public_ip.vm.ip_address
}

output "appgw_public_ip" {
  description = "Public IP of the Application Gateway (analytics dashboard)"
  value       = azurerm_public_ip.appgw.ip_address
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.vm.ip_address}"
}

output "analytics_dashboard_url" {
  description = "Analytics dashboard URL (via WAF)"
  value       = "http://${azurerm_public_ip.appgw.ip_address}"
}

output "langfuse_url" {
  description = "LangFuse URL (admin access only)"
  value       = "http://${azurerm_public_ip.vm.ip_address}:3001"
}

output "deploy_command" {
  description = "Deploy command from local desktop"
  value       = "make cloud-deploy VM_IP=${azurerm_public_ip.vm.ip_address}"
}
