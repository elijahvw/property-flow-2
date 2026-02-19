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

module "ecr" {
  source                  = "../../modules/ecr"
  environment             = var.environment
  aws_region              = var.aws_region
  vpc_id                  = module.network.vpc_id
  public_subnets          = module.network.public_subnets
  auth0_domain            = var.auth0_domain
  auth0_audience          = var.auth0_audience
  auth0_m2m_client_id     = var.auth0_m2m_client_id
  auth0_m2m_client_secret = var.auth0_m2m_client_secret
}

module "s3_frontend" {
  source = "../../modules/s3_frontend"
  vars = {
    environment  = var.environment
    alb_dns_name = module.ecr.alb_dns_name
  }
}
