terraform {
  required_version = ">= 1.5"
  required_providers {
    grafana = { source = "grafana/grafana", version = ">= 4.50.0, < 5.0" }
  }
  backend "s3" {}
}

# Separate root: ordinary app deployments need no Cloud Provider credential.
# Supply GRAFANA_CLOUD_ACCESS_POLICY_TOKEN and
# GRAFANA_CLOUD_PROVIDER_ACCESS_TOKEN in the process environment, not tfvars.
provider "grafana" { alias = "cloud" }
data "grafana_cloud_stack" "app" {
  provider = grafana.cloud
  slug     = var.stack_slug
  lifecycle {
    postcondition {
      condition     = tostring(self.prometheus_user_id) == var.external_id
      error_message = "The selected Grafana stack does not match the reviewed AWS External ID."
    }
  }
}
provider "grafana" {
  cloud_provider_url = data.grafana_cloud_stack.app.cloud_provider_url
}
variable "stack_slug" {
  type    = string
  default = "slimpillar2069"
}
variable "external_id" {
  type    = string
  default = "3678509"
}
variable "role_arn" {
  type        = string
  description = "grafana_cloudwatch_role_arn output from the approved dev infrastructure apply."
  validation {
    condition     = can(regex("^arn:aws:iam::800754316001:role/propertyflow-dev-grafana-cloudwatch$", var.role_arn))
    error_message = "Use the Property Flow dev CloudWatch read role from the intended AWS account."
  }
}
variable "regions" {
  type    = set(string)
  default = ["us-east-1"]
}
variable "collection_enabled" {
  type        = bool
  default     = false
  description = "Enable collection only in the explicitly approved cloud release."
}
resource "grafana_cloud_provider_aws_account" "app" {
  stack_id = data.grafana_cloud_stack.app.id
  role_arn = var.role_arn
  regions  = var.regions
}
locals {
  # Existing standard service metrics; no paid Container Insights, metric
  # streams, all-metrics wildcard or extra AWS collectors are provisioned.
  metrics = {
    "AWS/ECS" = {
      CPUUtilization = ["Average"], MemoryUtilization = ["Average"]
    }
    "AWS/RDS" = {
      CPUUtilization = ["Average"], DatabaseConnections = ["Average"],
      FreeableMemory = ["Minimum"], FreeStorageSpace = ["Minimum"],
      ReadLatency    = ["Average"], WriteLatency = ["Average"]
    }
    "AWS/ApplicationELB" = {
      RequestCount           = ["Sum"], HTTPCode_Target_5XX_Count = ["Sum"],
      HTTPCode_ELB_5XX_Count = ["Sum"], TargetResponseTime = ["Average"],
      UnHealthyHostCount     = ["Maximum"], HealthyHostCount = ["Minimum"]
    }
  }
}
resource "grafana_cloud_provider_aws_cloudwatch_scrape_job" "app" {
  stack_id                = data.grafana_cloud_stack.app.id
  name                    = "propertyflow-dev-infrastructure"
  aws_account_resource_id = grafana_cloud_provider_aws_account.app.resource_id
  enabled                 = var.collection_enabled
  export_tags             = false
  static_labels           = { application = "propertyflow", environment = "dev" }
  dynamic "service" {
    for_each = local.metrics
    content {
      name                    = service.key
      scrape_interval_seconds = 300
      tags_to_add_to_metrics  = ["Application", "Environment"]
      resource_discovery_tag_filter {
        key   = "Application"
        value = "propertyflow"
      }
      resource_discovery_tag_filter {
        key   = "Environment"
        value = "dev"
      }
      dynamic "metric" {
        for_each = service.value
        content {
          name       = metric.key
          statistics = metric.value
        }
      }
    }
  }
}
output "aws_account_resource_id" { value = grafana_cloud_provider_aws_account.app.resource_id }
output "scrape_job_id" { value = grafana_cloud_provider_aws_cloudwatch_scrape_job.app.id }
