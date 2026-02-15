variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnets" { type = list(string) }

resource "aws_db_subnet_group" "default" {
  name       = "propertyflow-${var.environment}-db-subnet-group"
  subnet_ids = var.public_subnets
  tags       = { Name = "propertyflow-${var.environment}-db-subnet-group" }
}

resource "aws_security_group" "db" {
  name   = "propertyflow-${var.environment}-db-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # For dev simplicity; in prod, restrict to ECS SG
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "default" {
  identifier           = "propertyflow-${var.environment}-db"
  allocated_storage    = 20
  storage_type         = "gp2"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.t3.micro"
  db_name              = "propertyflow"
  username             = "postgres"
  password             = "password123" # Should be in Secrets Manager for prod
  parameter_group_name = "default.postgres15"
  skip_final_snapshot  = true
  publicly_accessible  = true
  db_subnet_group_name = aws_db_subnet_group.default.name
  vpc_security_group_ids = [aws_security_group.db.id]
}

output "db_endpoint" { value = aws_db_instance.default.endpoint }
