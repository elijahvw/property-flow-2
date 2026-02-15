output "cloudfront_url" {
  value = module.s3_frontend.cloudfront_domain_name
}

output "api_url" {
  value = "http://${module.ecr.alb_dns_name}"
}

output "db_endpoint" {
  value = module.rds.db_endpoint
}
