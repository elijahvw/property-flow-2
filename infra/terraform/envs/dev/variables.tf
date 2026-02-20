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
