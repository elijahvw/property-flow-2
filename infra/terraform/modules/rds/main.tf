resource "aws_db_subnet_group" "main" {
  name       = "propertyflow-${var.vars.environment}-db-subnet-group"
  subnet_ids = var.vars.private_subnets
  tags       = { Name = "propertyflow-${var.vars.environment}-db-subnet-group" }
}

resource "aws_security_group" "rds" {
  name   = "propertyflow-${var.vars.environment}-rds-sg"
  vpc_id = var.vars.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.vars.ecs_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_rds_cluster" "postgresql" {
  cluster_identifier      = "propertyflow-${var.vars.environment}-db"
  engine                  = "aurora-postgresql"
  engine_mode             = "provisioned"
  engine_version          = "15.4"
  database_name           = var.vars.db_name
  master_username         = var.vars.db_user
  master_password         = var.vars.db_password
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  skip_final_snapshot     = true
  apply_immediately       = true

  serverlessv2_scaling_configuration {
    max_capacity = 1.0
    min_capacity = 0.5
  }
}

resource "aws_rds_cluster_instance" "postgresql" {
  cluster_identifier = aws_rds_cluster.postgresql.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.postgresql.engine
  engine_version     = aws_rds_cluster.postgresql.engine_version
  publicly_accessible = false
}

output "db_endpoint" {
  value = aws_rds_cluster.postgresql.endpoint
}
