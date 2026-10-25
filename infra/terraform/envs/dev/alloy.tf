variable "grafana_alloy_enabled" {
  type        = bool
  default     = false
  description = "Enable after setting the GRAFANA_ALLOY_TOKEN GitHub Actions secret."
}

variable "grafana_alloy_ecs_metrics_enabled" {
  type        = bool
  default     = false
  description = "Explicit opt-in to Alloy's experimental per-container ECS resource receiver."
}
