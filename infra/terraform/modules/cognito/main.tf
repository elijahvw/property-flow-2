resource "aws_cognito_user_pool" "pool" {
  name = "propertyflow-${var.environment}-user-pool"

  password_policy {
    minimum_length = 8
  }

  auto_verified_attributes = ["email"]
}

resource "aws_cognito_user_pool_client" "client" {
  name = "propertyflow-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.pool.id
}

variable "environment" { type = string }

output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.client.id
}
