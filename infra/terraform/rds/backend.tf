# ============================================================
# Remote state — store tfstate in S3, lock in DynamoDB.
# This prevents concurrent applies from corrupting state.
# Run `terraform init` after changing this.
# ============================================================
terraform {
  backend "s3" {
    bucket = "enterprise-ai-terraform-state-393035998869"
    key            = "rds/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "enterprise-ai-terraform-locks"
  }
}
