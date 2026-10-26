variable "alloy_enabled" {
  type        = bool
  default     = false
  description = "Run Alloy in the application task; its token is injected from the existing ingestion secret."
}

variable "alloy_ecs_metrics_enabled" {
  type        = bool
  default     = false
  description = "Opt into Alloy's experimental ECS metadata receiver for per-container resource measurements."
}

variable "alloy_fleet_url" {
  type    = string
  default = "https://fleet-management-prod-028.grafana.net"
  validation {
    condition     = can(regex("^https://fleet-management-[a-z0-9.-]+[.]grafana[.]net/?$", var.alloy_fleet_url))
    error_message = "Use the HTTPS Fleet Management base URL shown in this Grafana stack's setup screen."
  }
}

variable "alloy_fleet_id" {
  type    = string
  default = "1877143"
  validation {
    condition     = can(regex("^[0-9]+$", var.alloy_fleet_id))
    error_message = "Use the numeric Fleet Management instance ID, not the metrics instance ID."
  }
}

locals {
  task_cpu    = 512
  task_memory = var.alloy_enabled ? 2048 : 1024
  alloy_config = templatefile("${path.module}/alloy/config.alloy.tftpl", {
    fleet_url           = var.alloy_fleet_url
    fleet_id            = var.alloy_fleet_id
    environment         = var.vars.environment
    ecs_metrics_enabled = var.alloy_ecs_metrics_enabled
  })
  alloy_containers = var.alloy_enabled && var.vars.grafana_otlp_endpoint != "" ? [{
    name        = "alloy"
    image       = "grafana/alloy:v1.21.1"
    essential   = false
    cpu         = 128
    memory      = 512
    stopTimeout = 60
    # The standard image includes bash but no curl/wget. Use bash for readiness.
    entryPoint = ["/bin/bash", "-ec"]
    command = [join(" ", [
      "umask 077; printf '%s\\n' \"$ALLOY_CONFIG\" > /tmp/config.alloy;",
      "exec /bin/alloy run --storage.path=/tmp/alloy --server.http.listen-addr=127.0.0.1:12345",
      var.alloy_ecs_metrics_enabled ? "--stability.level=experimental" : "--stability.level=generally-available",
      "/tmp/config.alloy"
    ])]
    environment = [
      { name = "ALLOY_CONFIG", value = local.alloy_config },
      { name = "ALLOY_DEPLOY_MODE", value = "ecs" }
    ]
    secrets = [{
      name      = "GRAFANA_ALLOY_TOKEN"
      valueFrom = "${aws_secretsmanager_secret.grafana[0].arn}:alloy_token::"
    }]
    healthCheck = {
      command  = ["CMD-SHELL", "/bin/bash -ec 'exec 3<>/dev/tcp/127.0.0.1/12345; printf \"GET /-/ready HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n\" >&3; read -r status <&3; [[ \"$status\" == *\" 200 \"* ]]'"]
      interval = 30, timeout = 5, retries = 3, startPeriod = 60
    }
    restartPolicy = { enabled = true, restartAttemptPeriod = 60 }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.vars.aws_region
        "awslogs-stream-prefix" = "alloy"
        "mode"                  = "non-blocking"
        "max-buffer-size"       = "1m"
      }
    }
  }] : []
}
