resource "aws_ecr_repository" "app" {
  name = "propertyflow-${var.vars.environment}-app"
  force_delete = true
}

resource "aws_ecs_cluster" "main" {
  name = "propertyflow-${var.vars.environment}-cluster"
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "propertyflow-${var.vars.environment}-ecs-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_lb" "main" {
  name               = "propertyflow-${var.vars.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.vars.alb_security_group_id]
  subnets            = var.vars.public_subnets
}

resource "aws_lb_target_group" "app" {
  name        = "propertyflow-${var.vars.environment}-tg"
  port        = 5011
  protocol    = "HTTP"
  vpc_id      = var.vars.vpc_id
  target_type = "ip"
  health_check {
    path = "/api/health"
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

  container_definitions = jsonencode([{
    name  = "app"
    image = "${aws_ecr_repository.app.repository_url}:latest"
    portMappings = [{
      containerPort = 5011
      hostPort      = 5011
    }]
    environment = [
      { name = "AUTH0_DOMAIN", value = var.vars.auth0_domain },
      { name = "AUTH0_AUDIENCE", value = var.vars.auth0_audience },
      { name = "VITE_AUTH0_AUDIENCE", value = var.vars.auth0_audience },
      { name = "AUTH0_MANAGEMENT_CLIENT_ID", value = var.vars.auth0_m2m_client_id },
      { name = "AUTH0_MANAGEMENT_CLIENT_SECRET", value = var.vars.auth0_m2m_client_secret },
      { name = "DATABASE_URL", value = var.vars.database_url }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.vars.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "propertyflow-${var.vars.environment}"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

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
