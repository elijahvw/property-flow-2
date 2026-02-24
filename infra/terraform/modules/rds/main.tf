resource "aws_db_subnet_group" "main" {
  name       = "propertyflow-${var.environment}-db-subnet-group"
  subnet_ids = concat(var.private_subnets, var.public_subnets)
  tags       = { Name = "propertyflow-${var.environment}-db-subnet-group" }
}

resource "aws_security_group" "rds" {
  name   = "propertyflow-${var.environment}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.ecs_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "postgresql" {
  identifier           = "propertyflow-${var.environment}-db"
  engine               = "postgres"
  engine_version       = "16.3"
  instance_class       = "db.t3.micro" # Free Tier eligible
  allocated_storage    = 20            # Minimum required for Standard RDS
  storage_type         = "gp2"
  db_name              = var.db_name
  username             = var.db_user
  password             = var.db_password
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  skip_final_snapshot  = true
  publicly_accessible  = false
  multi_az             = false
  storage_encrypted    = true
}

output "db_endpoint" {
  value = aws_db_instance.postgresql.address
}
