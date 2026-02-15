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

resource "aws_cognito_user_pool_client" "client" {
  name = "propertyflow-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.pool.id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["http://localhost:5000", "https://${var.cloudfront_domain}"]
  logout_urls                          = ["http://localhost:5000", "https://${var.cloudfront_domain}"]
  supported_identity_providers         = ["COGNITO"]
}

variable "environment" { type = string }
variable "account_id" { type = string }
variable "cloudfront_domain" { type = string }

output "user_pool_id" {
  value = aws_cognito_user_pool.pool.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.client.id
}

output "domain" {
  value = aws_cognito_user_pool_domain.main.domain
}
