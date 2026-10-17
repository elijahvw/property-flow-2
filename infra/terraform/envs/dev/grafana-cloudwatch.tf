variable "grafana_cloudwatch_external_id" {
  type        = string
  default     = "3678509"
  description = "Prometheus instance / External ID supplied from the Grafana AWS setup screen. Not an API token."
  validation {
    condition     = can(regex("^[0-9]+$", var.grafana_cloudwatch_external_id))
    error_message = "Use this Grafana stack's numeric External ID."
  }
}
module "grafana_cloudwatch" {
  source      = "../../modules/grafana_cloudwatch"
  environment = var.environment
  external_id = var.grafana_cloudwatch_external_id
}
output "grafana_cloudwatch_role_arn" {
  value       = module.grafana_cloudwatch.role_arn
  description = "AWS read role for the separate Grafana connection root, after approved apply."
}
