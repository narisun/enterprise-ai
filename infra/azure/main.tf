# ============================================================
# enterprise-ai — Azure Single-VM Deployment
#
# Creates: Resource Group, VNet, Subnet, NSG, Public IP, VM,
#          Application Gateway with WAF v2 (fronts analytics dashboard),
#          and a separate public IP for admin access (LangFuse + SSH).
#
# Architecture:
#   Internet → App Gateway (WAF) → VM:3003 (analytics dashboard)
#   Admin IP → VM:3001 (LangFuse, restricted by NSG)
#   Admin IP → VM:22   (SSH, restricted by NSG)
# ============================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
  }
}

provider "azurerm" {
  features {}
}

# ---- Resource Group ----

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# ---- Virtual Network ----

resource "azurerm_virtual_network" "main" {
  name                = "vnet-enterprise-ai"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags
}

# VM subnet
resource "azurerm_subnet" "vm" {
  name                 = "snet-vm"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

# Application Gateway requires its own dedicated subnet
resource "azurerm_subnet" "appgw" {
  name                 = "snet-appgw"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

# ---- Network Security Group (VM) ----

resource "azurerm_network_security_group" "vm" {
  name                = "nsg-vm"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  # SSH — admin IPs only
  security_rule {
    name                       = "AllowSSH"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefixes    = var.admin_ip_cidrs
    destination_address_prefix = "*"
  }

  # LangFuse — admin IPs only
  security_rule {
    name                       = "AllowLangFuse"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3001"
    source_address_prefixes    = var.admin_ip_cidrs
    destination_address_prefix = "*"
  }

  # Analytics Dashboard — from App Gateway subnet only
  security_rule {
    name                       = "AllowAppGwToAnalytics"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "3003"
    source_address_prefix      = "10.0.2.0/24"
    destination_address_prefix = "*"
  }

  # HTTP from App Gateway (health probes and Let's Encrypt challenge)
  security_rule {
    name                       = "AllowHTTP"
    priority                   = 210
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # HTTPS from App Gateway
  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 220
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # App Gateway v2 health probes
  security_rule {
    name                       = "AllowAppGwHealth"
    priority                   = 300
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "65200-65535"
    source_address_prefix      = "GatewayManager"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "vm" {
  subnet_id                 = azurerm_subnet.vm.id
  network_security_group_id = azurerm_network_security_group.vm.id
}

# ---- Public IPs ----

# Public IP for the VM (SSH + LangFuse admin access)
resource "azurerm_public_ip" "vm" {
  name                = "pip-vm"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

# Public IP for Application Gateway (user-facing analytics dashboard)
resource "azurerm_public_ip" "appgw" {
  name                = "pip-appgw"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

# ---- VM Network Interface ----

resource "azurerm_network_interface" "vm" {
  name                = "nic-vm"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = var.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.vm.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.vm.id
  }
}

# ---- Linux VM ----

resource "azurerm_linux_virtual_machine" "main" {
  name                = "vm-enterprise-ai"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  size                = var.vm_size
  admin_username      = var.admin_username
  tags                = var.tags

  network_interface_ids = [azurerm_network_interface.vm.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(var.ssh_public_key_path)
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = 128
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  custom_data = filebase64("${path.module}/cloud-init.yaml")
}

# ---- Application Gateway with WAF v2 ----

resource "azurerm_web_application_firewall_policy" "main" {
  name                = "waf-policy-enterprise-ai"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = var.tags

  policy_settings {
    enabled                     = true
    mode                        = "Prevention"
    request_body_check          = true
    file_upload_limit_in_mb     = 100
    max_request_body_size_in_kb = 128
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"
    }
  }
}

resource "azurerm_application_gateway" "main" {
  name                = "appgw-enterprise-ai"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tags                = var.tags

  firewall_policy_id = azurerm_web_application_firewall_policy.main.id

  # Use a current TLS policy — Azure rejects the legacy default (AppGwSslPolicy20150501)
  ssl_policy {
    policy_type = "Predefined"
    policy_name = "AppGwSslPolicy20220101"
  }

  sku {
    name     = "WAF_v2"
    tier     = "WAF_v2"
    capacity = 1
  }

  gateway_ip_configuration {
    name      = "gateway-ip-config"
    subnet_id = azurerm_subnet.appgw.id
  }

  frontend_ip_configuration {
    name                 = "frontend-ip"
    public_ip_address_id = azurerm_public_ip.appgw.id
  }

  frontend_port {
    name = "http-port"
    port = 80
  }

  # Backend pool: the single VM running the analytics dashboard
  backend_address_pool {
    name         = "analytics-backend"
    ip_addresses = [azurerm_network_interface.vm.private_ip_address]
  }

  backend_http_settings {
    name                  = "analytics-http-settings"
    cookie_based_affinity = "Disabled"
    port                  = 3003
    protocol              = "Http"
    request_timeout       = 60

    probe_name = "analytics-health"
  }

  probe {
    name                = "analytics-health"
    host                = azurerm_network_interface.vm.private_ip_address
    path                = "/"
    protocol            = "Http"
    interval            = 30
    timeout             = 10
    unhealthy_threshold = 3
    port                = 3003
  }

  http_listener {
    name                           = "http-listener"
    frontend_ip_configuration_name = "frontend-ip"
    frontend_port_name             = "http-port"
    protocol                       = "Http"
  }

  request_routing_rule {
    name                       = "analytics-routing"
    priority                   = 100
    rule_type                  = "Basic"
    http_listener_name         = "http-listener"
    backend_address_pool_name  = "analytics-backend"
    backend_http_settings_name = "analytics-http-settings"
  }
}
