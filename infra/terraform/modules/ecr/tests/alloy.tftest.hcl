mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "800754316001" }
}

override_resource {
  target          = aws_ecr_repository.app
  override_during = plan
  values          = { repository_url = "800754316001.dkr.ecr.us-east-1.amazonaws.com/propertyflow-dev-app" }
}

override_resource {
  target          = aws_secretsmanager_secret.grafana[0]
  override_during = plan
  values          = { arn = "arn:aws:secretsmanager:us-east-1:800754316001:secret:propertyflow-dev-grafana-otlp-ABC123" }
}

variables {
  vars = {
    app_origin               = "https://propertyflow.saasapps.cloud"
    cloudfront_origin_secret = "isolated-origin"
    auth0_web_client_id      = "isolated-client"
    auth0_web_client_secret  = "isolated-client-secret"
    runtime_db_password      = "isolated-runtime-password"
    environment              = "dev"
    aws_region               = "us-east-1"
    vpc_id                   = "vpc-12345678"
    public_subnets           = ["subnet-12345678", "subnet-87654321"]
    alb_security_group_id    = "sg-12345678"
    ecs_security_group_id    = "sg-87654321"
    auth0_domain             = "isolated.auth0.com"
    auth0_audience           = "isolated-audience"
    auth0_m2m_client_id      = "isolated-management"
    auth0_m2m_client_secret  = "isolated-management-secret"
    db_name                  = "isolated"
    db_user                  = "isolated"
    db_password              = "isolated-password"
    db_endpoint              = "isolated.us-east-1.rds.amazonaws.com"
    grafana_otlp_endpoint    = "https://otlp-gateway-prod-us-east-3.grafana.net/otlp"
  }
}

run "disabled_preserves_existing_task" {
  command = plan
  assert {
    condition     = aws_ecs_task_definition.app.cpu == "512" && aws_ecs_task_definition.app.memory == "1024" && length(jsondecode(aws_ecs_task_definition.app.container_definitions)) == 1
    error_message = "Disabled Alloy must preserve the scanner-free app task size and containers."
  }
}

run "collector_shares_the_power_controlled_task" {
  command = plan
  variables { alloy_enabled = true }
  assert {
    condition     = aws_ecs_task_definition.app.cpu == "512" && aws_ecs_task_definition.app.memory == "2048" && length(jsondecode(aws_ecs_task_definition.app.container_definitions)) == 2
    error_message = "Alloy must fit inside the existing application task with valid Fargate capacity."
  }
  assert {
    condition     = sum([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.memory]) < tonumber(aws_ecs_task_definition.app.memory) && sum([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.cpu]) <= tonumber(aws_ecs_task_definition.app.cpu)
    error_message = "Combined container limits must fit, with task memory headroom."
  }
  assert {
    condition     = local.alloy_containers[0].essential == false && local.alloy_containers[0].memory == 512 && !can(local.alloy_containers[0].portMappings) && local.alloy_containers[0].healthCheck.startPeriod == 60
    error_message = "Collector failures must not stop the app or expose a public management listener."
  }
  assert {
    condition     = endswith(local.alloy_containers[0].secrets[0].valueFrom, ":alloy_token::") && !strcontains(local.alloy_config, "otelcol.receiver.awsecscontainermetrics") && strcontains(local.alloy_config, "sys.env(\"GRAFANA_ALLOY_TOKEN\")")
    error_message = "Use a runtime token reference and keep the experimental receiver opt-in."
  }
  assert {
    condition     = !contains([for c in jsondecode(aws_ecs_task_definition.app.container_definitions) : c.name], "document-scanner")
    error_message = "The retired scanner must never be reintroduced into the application task."
  }
}

run "explicit_container_metrics_opt_in" {
  command = plan
  variables {
    alloy_enabled             = true
    alloy_ecs_metrics_enabled = true
  }
  assert {
    condition     = strcontains(local.alloy_config, "otelcol.receiver.awsecscontainermetrics") && strcontains(local.alloy_containers[0].command[0], "--stability.level=experimental")
    error_message = "Experimental ECS collection requires both the receiver configuration and matching CLI stability level."
  }
}

run "reject_credentialed_fleet_url" {
  command = plan
  variables { alloy_fleet_url = "https://token@fleet-management-prod.grafana.net" }
  expect_failures = [var.alloy_fleet_url]
}
