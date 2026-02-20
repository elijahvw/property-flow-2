terraform {
  required_version = ">= 1.0"

  required_providers {
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
  source = "../../modules/rds"
  vars = {
    environment           = var.environment
    vpc_id                = module.network.vpc_id
    private_subnets       = module.network.private_subnets
    public_subnets        = module.network.public_subnets
    db_name               = var.db_name
    db_user               = var.db_user
    db_password           = var.db_password
    ecs_security_group_id = module.network.ecs_security_group_id
  }
}

module "ecr" {
  source = "../../modules/ecr"
  vars = {
    environment             = var.environment
    aws_region              = var.aws_region
    vpc_id                  = module.network.vpc_id
    public_subnets          = module.network.public_subnets
    alb_security_group_id   = module.network.alb_security_group_id
    ecs_security_group_id   = module.network.ecs_security_group_id
    auth0_domain            = var.auth0_domain
    auth0_audience          = var.auth0_audience
    auth0_m2m_client_id     = var.auth0_m2m_client_id
    auth0_m2m_client_secret = var.auth0_m2m_client_secret
    database_url            = "postgresql://${var.db_user}:${var.db_password}@${module.rds.db_endpoint}:5432/${var.db_name}?sslmode=require"
  }
}

module "s3_frontend" {
  source = "../../modules/s3_frontend"
  vars = {
    environment  = var.environment
    alb_dns_name = module.ecr.alb_dns_name
  }
}
