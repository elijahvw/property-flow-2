resource "aws_ecr_repository" "api" {
  name                 = "propertyflow-${var.environment}-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

variable "environment" { type = string }

output "repository_url" {
  value = aws_ecr_repository.api.repository_url
}
