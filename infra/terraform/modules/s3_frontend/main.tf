resource "aws_s3_bucket" "frontend" {
  bucket = "propertyflow-${var.environment}-frontend"
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  index_document { suffix = "index.html" }
}

variable "environment" { type = string }

output "bucket_name" {
  value = aws_s3_bucket.frontend.id
}
