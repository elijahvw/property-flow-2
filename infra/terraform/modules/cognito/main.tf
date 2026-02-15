resource "aws_cognito_user_pool" "pool" {
  name = "propertyflow-${var.environment}-user-pool"

  password_policy {
    minimum_length = 8
  }

  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "propertyflow-${var.environment}-${var.account_id}"
  user_pool_id = aws_cognito_user_pool.pool.id
}

variable "environment" { type = string }
variable "account_id" { type = string }

output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "domain" {
  value = aws_cognito_user_pool_domain.main.domain
}
