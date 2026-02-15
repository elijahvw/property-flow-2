variable "environment" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "propertyflow-${var.environment}-vpc"
  }
}

output "vpc_id" {
  value = aws_vpc.main.id
}
