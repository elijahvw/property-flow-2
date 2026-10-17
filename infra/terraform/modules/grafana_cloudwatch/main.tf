terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
variable "environment" { type = string }
variable "external_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]+$", var.external_id))
    error_message = "Use the numeric External ID shown in this Grafana Cloud stack's AWS setup."
  }
}
data "aws_iam_policy_document" "trust" {
  statement {
    sid     = "GrafanaCloudWithExactExternalId"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::008923505280:root"]
    }
    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.external_id]
    }
  }
}
resource "aws_iam_role" "cloudwatch" {
  name               = "propertyflow-${var.environment}-grafana-cloudwatch"
  description        = "Grafana Cloud read-only CloudWatch metrics discovery"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = { Application = "propertyflow", Environment = var.environment }
}
data "aws_iam_policy_document" "read" {
  statement {
    sid     = "ReadCloudWatchMetricsAndResourceTags"
    actions = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics", "tag:GetResources"]
    # These read APIs do not support resource ARN restrictions. The scrape
    # filters select app tags; the IAM metric/tag read grant is account-wide.
    resources = ["*"]
  }
}
resource "aws_iam_role_policy" "read" {
  name   = "propertyflow-cloudwatch-metrics-read"
  role   = aws_iam_role.cloudwatch.id
  policy = data.aws_iam_policy_document.read.json
}
output "role_arn" {
  value      = aws_iam_role.cloudwatch.arn
  depends_on = [aws_iam_role_policy.read]
}
