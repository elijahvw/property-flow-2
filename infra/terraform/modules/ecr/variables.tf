variable "environment" { type = string }
variable "aws_region" { type = string }
variable "vpc_id" { type = string }
variable "public_subnets" { type = list(string) }
variable "auth0_domain" { type = string }
variable "auth0_audience" { type = string }
variable "auth0_m2m_client_id" { type = string }
variable "auth0_m2m_client_secret" { type = string }
