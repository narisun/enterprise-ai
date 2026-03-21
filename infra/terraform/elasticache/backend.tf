terraform {
  backend "s3" {
    bucket = "enterprise-ai-terraform-state-393035998869"
    key            = "elasticache/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "enterprise-ai-terraform-locks"
  }
}
