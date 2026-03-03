variable "vars" {
  type = object({
    environment             = string
    aws_region              = string
    vpc_id                  = string
    public_subnets          = list(string)
    alb_security_group_id   = string
    ecs_security_group_id   = string
    auth0_domain            = string
    auth0_audience          = string
    auth0_m2m_client_id     = string
    auth0_m2m_client_secret = string
    db_name                 = string
    db_user                 = string
    db_password             = string
    db_endpoint             = string
    datadog_api_key         = string
    datadog_site            = string
  })
}
