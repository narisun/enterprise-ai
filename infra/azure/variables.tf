# ============================================================
# enterprise-ai — Azure Variables
# ============================================================

variable "resource_group_name" {
  description = "Name of the Azure resource group"
  type        = string
  default     = "rg-enterprise-ai"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "eastus2"
}

variable "vm_size" {
  description = "Azure VM size (4 vCPU / 16 GB RAM recommended minimum)"
  type        = string
  default     = "Standard_D4s_v3"
}

variable "admin_username" {
  description = "SSH admin username for the VM"
  type        = string
  default     = "azureuser"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key for VM access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "admin_ip_cidrs" {
  description = "CIDR blocks allowed to SSH into the VM and access LangFuse (your IP)"
  type        = list(string)
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    project     = "enterprise-ai"
    environment = "production"
    managed_by  = "terraform"
  }
}
