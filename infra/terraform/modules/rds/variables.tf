variable "vars" {
  type = object({
    environment           = string
    vpc_id                = string
    private_subnets       = list(string)
    public_subnets        = list(string)
    db_name               = string
    db_user               = string
    db_password           = string
    ecs_security_group_id = string
  })
}
