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

module "rds" {
  source         = "../../modules/rds_postgres"
  environment    = var.environment
  vpc_id         = module.network.vpc_id
  public_subnets = module.network.public_subnets
}

module "cognito" {
  source      = "../../modules/cognito"
  environment = var.environment
  account_id  = data.aws_caller_identity.current.account_id
}

module "ecr" {
  source               = "../../modules/ecs_api"
  environment          = var.environment
  vpc_id               = module.network.vpc_id
  public_subnets       = module.network.public_subnets
  db_endpoint          = module.rds.db_endpoint
  cognito_user_pool_id = module.cognito.user_pool_id
  aws_region           = var.aws_region
  database_url         = var.database_url
}

module "s3_frontend" {
  source       = "../../modules/s3_frontend"
  environment  = var.environment
  alb_dns_name = module.ecr.alb_dns_name
}

resource "aws_cognito_user_pool_client" "client" {
  name         = "propertyflow-${var.environment}-client"
  user_pool_id = module.cognito.user_pool_id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  callback_urls                        = ["http://localhost:5000", "https://${module.s3_frontend.cloudfront_domain_name}"]
  logout_urls                          = ["http://localhost:5000", "https://${module.s3_frontend.cloudfront_domain_name}"]
  supported_identity_providers         = ["COGNITO"]
}
