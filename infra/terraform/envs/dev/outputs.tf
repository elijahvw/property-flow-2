output "cloudfront_url" {
  value = module.s3_frontend.cloudfront_domain_name
}

output "cloudfront_distribution_id" {
  value = module.s3_frontend.cloudfront_distribution_id
}

output "repository_url" {
  value = module.ecr.repository_url
}

output "ecs_cluster_name" {
  value = module.ecr.ecs_cluster_name
}

output "ecs_service_name" {
  value = module.ecr.ecs_service_name
}

output "alb_dns_name" {
  value = module.ecr.alb_dns_name
}
