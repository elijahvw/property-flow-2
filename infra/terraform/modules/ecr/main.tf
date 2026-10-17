resource "aws_ecr_repository" "app" {
  name         = "propertyflow-${var.vars.environment}-app"
  force_delete = true
}

locals {
  runtime_database_url = format("postgresql://propertyflow_runtime:%s@%s:5432/%s", urlencode(var.vars.runtime_db_password), var.vars.db_endpoint, urlencode(var.vars.db_name))
  database_url = format(
    "postgresql://%s:%s@%s:5432/%s?schema=public&sslmode=verify-full",
    urlencode(var.vars.db_user),
    urlencode(var.vars.db_password),
    var.vars.db_endpoint,
    urlencode(var.vars.db_name)
  )
}

resource "aws_ecs_cluster" "main" {
  tags = { Application = "propertyflow", Environment = var.vars.environment }
  name = "propertyflow-${var.vars.environment}-cluster"
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "propertyflow-${var.vars.environment}-ecs-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_lb" "main" {
  tags               = { Application = "propertyflow", Environment = var.vars.environment }
  name               = "propertyflow-${var.vars.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.vars.alb_security_group_id]
  subnets            = var.vars.public_subnets
}

resource "aws_lb_target_group" "app" {
  tags        = { Application = "propertyflow", Environment = var.vars.environment }
  name        = "propertyflow-${var.vars.environment}-tg"
  port        = 5011
  protocol    = "HTTP"
  vpc_id      = var.vars.vpc_id
  target_type = "ip"
  # Dev HTTP requests are bounded; retain one minute for in-flight requests.
  deregistration_delay = 60
  health_check {
    path                = "/api/ready"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/propertyflow-${var.vars.environment}"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "app" {
  family                   = "propertyflow-${var.vars.environment}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  # Execution-role privileges are not granted to application code.

  container_definitions = jsonencode([
    {
      name  = "app"
      image = "${aws_ecr_repository.app.repository_url}:latest"
      portMappings = [{
        containerPort = 5011
        hostPort      = 5011
      }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AUTH0_DOMAIN", value = var.vars.auth0_domain },
        { name = "AUTH0_AUDIENCE", value = var.vars.auth0_audience },
        { name = "VITE_AUTH0_AUDIENCE", value = var.vars.auth0_audience },
        { name = "APP_ORIGIN", value = var.vars.app_origin },
        { name = "CLOUDFRONT_ORIGIN_SECRET", value = var.vars.cloudfront_origin_secret },
        { name = "AUTH0_WEB_CLIENT_ID", value = var.vars.auth0_web_client_id },
        { name = "AUTH0_WEB_CLIENT_SECRET", value = var.vars.auth0_web_client_secret },
        { name = "AUTH0_MANAGEMENT_CLIENT_ID", value = var.vars.auth0_m2m_client_id },
        { name = "AUTH0_MANAGEMENT_CLIENT_SECRET", value = var.vars.auth0_m2m_client_secret },
        { name = "RUNTIME_DATABASE_URL", value = local.runtime_database_url },
        { name = "DATABASE_URL", value = local.database_url },
        { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = var.vars.grafana_otlp_endpoint },
        { name = "APP_ENV", value = var.vars.environment },
        { name = "APP_CPU_CORES", value = "0.25" }
      ]
      secrets = var.vars.grafana_otlp_endpoint == "" ? [] : [{
        name      = "OTEL_EXPORTER_OTLP_HEADERS"
        valueFrom = "${aws_secretsmanager_secret.grafana[0].arn}:headers::"
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = var.vars.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  tags = { Application = "propertyflow", Environment = var.vars.environment }
  # ECS requires the target group to be attached to a listener first.
  depends_on = [aws_lb_listener.http, aws_iam_role_policy.grafana_ingestion]

  name                              = "propertyflow-${var.vars.environment}"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.vars.public_subnets
    security_groups  = [var.vars.ecs_security_group_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 5011
  }
}

output "alb_dns_name" { value = aws_lb.main.dns_name }
output "repository_url" { value = aws_ecr_repository.app.repository_url }
output "ecs_cluster_name" { value = aws_ecs_cluster.main.name }
output "ecs_service_name" { value = aws_ecs_service.app.name }


# Only metadata is managed here. Deploy Dev stores the value from a GitHub
# Actions secret before its checked rollout; credentials never enter TF state.
resource "aws_secretsmanager_secret" "grafana" {
  count                   = var.vars.grafana_otlp_endpoint == "" ? 0 : 1
  name                    = "propertyflow-${var.vars.environment}-grafana-otlp"
  description             = "Grafana Cloud write-only OTLP authorization headers"
  recovery_window_in_days = 7
}
resource "aws_iam_role_policy" "grafana_ingestion" {
  count = var.vars.grafana_otlp_endpoint == "" ? 0 : 1
  name  = "grafana-ingestion-secret"
  role  = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_secretsmanager_secret.grafana[0].arn
  }] })
}
output "grafana_secret_arn" { value = var.vars.grafana_otlp_endpoint == "" ? "" : aws_secretsmanager_secret.grafana[0].arn }
