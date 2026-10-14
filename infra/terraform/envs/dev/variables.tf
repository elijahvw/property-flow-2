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
  type = string
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

variable "datadog_api_key" {
  type      = string
  sensitive = true
}

variable "datadog_site" {
  type    = string
  default = "datadoghq.com"
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
