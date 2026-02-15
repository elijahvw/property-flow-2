terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # These will be passed via backend.tfvars or CLI in the pipeline
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "propertyflow"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

module "network" {
  source      = "../../modules/network"
  environment = var.environment
  vpc_cidr    = var.vpc_cidr
}

module "ecr" {
  source         = "../../modules/ecs_api"
  environment    = var.environment
  vpc_id         = module.network.vpc_id
  public_subnets = module.network.public_subnets
}

module "cognito" {
  source            = "../../modules/cognito"
  environment       = var.environment
  account_id        = data.aws_caller_identity.current.account_id
  cloudfront_domain = module.s3_frontend.cloudfront_domain_name
}

module "s3_frontend" {
  source       = "../../modules/s3_frontend"
  environment  = var.environment
  alb_dns_name = module.ecr.alb_dns_name
}

module "rds" {
  source         = "../../modules/rds_postgres"
  environment    = var.environment
  vpc_id         = module.network.vpc_id
  public_subnets = module.network.public_subnets
}
