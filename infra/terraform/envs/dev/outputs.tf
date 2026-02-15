output "cloudfront_url" {
  value = module.s3_frontend.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.s3_frontend.cloudfront_distribution_id
}

output "api_url" {
  value = "http://${module.ecr.alb_dns_name}"
}

output "db_endpoint" {
  value = module.rds.db_endpoint
}

output "cognito_domain" {
  value = "https://${module.cognito.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_client_id" {
  value = module.cognito.client_id
}

output "cognito_user_pool_id" {
  value = module.cognito.user_pool_id
}
