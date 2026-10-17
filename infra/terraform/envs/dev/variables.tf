variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "auth0_domain" {
  type = string
}

variable "auth0_audience" {
  type = string
}

variable "auth0_m2m_client_id" {
  type = string
}

variable "auth0_m2m_client_secret" {
  type      = string
  sensitive = true
}

variable "db_name" {
  type    = string
  default = "propertyflow"
}

variable "db_user" {
  type    = string
  default = "dbadmin"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "app_origin" {
  type    = string
  default = "https://drfbeumseaytt.cloudfront.net"
}
variable "auth0_web_client_id" {
  type = string
  validation {
    condition     = length(var.auth0_web_client_id) > 0
    error_message = "Set the AUTH0_WEB_CLIENT_ID GitHub Actions variable before deployment."
  }
}
variable "auth0_web_client_secret" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.auth0_web_client_secret) > 0
    error_message = "Set the AUTH0_WEB_CLIENT_SECRET GitHub Actions secret before deployment."
  }
}

variable "grafana_otlp_endpoint" {
  type        = string
  default     = ""
  description = "Grafana Cloud OTLP gateway base URL ending /otlp; empty keeps exports disabled. Credentials are injected by ECS from Secrets Manager."
  validation {
    condition     = var.grafana_otlp_endpoint == "" || can(regex("^https://otlp-gateway-[a-z0-9-]+[.]grafana[.]net/otlp$", var.grafana_otlp_endpoint))
    error_message = "Use the HTTPS Grafana Cloud OTLP gateway URL from Send data > OpenTelemetry (no credentials, query or fragment)."
  }
}

variable "frontend_custom_domain" {
  description = "Optional public hostname and issued us-east-1 ACM certificate. Configured in custom-domain.auto.tfvars.json; null explicitly restores the original app origin and CloudFront URL."
  type = object({
    hostname        = string
    certificate_arn = string
  })
  default = null
}
