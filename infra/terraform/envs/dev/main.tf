terraform {
  required_version = ">= 1.0"

  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
  }
}

provider "aws" {
  region = var.aws_region
}

module "network" {
  source = "../../modules/network"
  vars = {
    environment = var.environment
    vpc_cidr    = var.vpc_cidr
  }
}

module "rds" {
  source                = "../../modules/rds"
  environment           = var.environment
  vpc_id                = module.network.vpc_id
  private_subnets       = module.network.private_subnets
  public_subnets        = module.network.public_subnets
  db_name               = var.db_name
  db_user               = var.db_user
  db_password           = var.db_password
  ecs_security_group_id = module.network.ecs_security_group_id
}

resource "random_password" "cloudfront_origin" {
  length  = 40
  special = false
}

resource "random_password" "runtime_database" {
  length  = 40
  special = false
}

module "ecr" {
  source = "../../modules/ecr"
  vars = {
    environment              = var.environment
    aws_region               = var.aws_region
    vpc_id                   = module.network.vpc_id
    public_subnets           = module.network.public_subnets
    alb_security_group_id    = module.network.alb_security_group_id
    ecs_security_group_id    = module.network.ecs_security_group_id
    app_origin               = var.app_origin
    cloudfront_origin_secret = random_password.cloudfront_origin.result
    auth0_web_client_id      = var.auth0_web_client_id
    auth0_web_client_secret  = var.auth0_web_client_secret
    runtime_db_password      = random_password.runtime_database.result
    auth0_domain             = var.auth0_domain
    auth0_audience           = var.auth0_audience
    auth0_m2m_client_id      = var.auth0_m2m_client_id
    auth0_m2m_client_secret  = var.auth0_m2m_client_secret
    db_name                  = var.db_name
    db_user                  = var.db_user
    db_password              = var.db_password
    db_endpoint              = module.rds.db_endpoint
    grafana_otlp_endpoint    = var.grafana_otlp_endpoint
  }
}

module "s3_frontend" {
  source = "../../modules/s3_frontend"
  vars = {
    environment              = var.environment
    alb_dns_name             = module.ecr.alb_dns_name
    cloudfront_origin_secret = random_password.cloudfront_origin.result
  }
}
