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
  source               = "../../modules/ecs_api"
  environment          = var.environment
  vpc_id               = module.network.vpc_id
  public_subnets       = module.network.public_subnets
  aws_region           = var.aws_region
  # Simplified for now (removed DB and Cognito dependencies)
}

module "s3_frontend" {
  source       = "../../modules/s3_frontend"
  environment  = var.environment
  alb_dns_name = module.ecr.alb_dns_name
}
