output "cloudfront_url" {
  value = module.s3_frontend.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.s3_frontend.cloudfront_distribution_id
}
