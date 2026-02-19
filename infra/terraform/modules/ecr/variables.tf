variable "vars" {
  type = object({
    environment             = string
    aws_region              = string
    vpc_id                  = string
    public_subnets          = list(string)
    auth0_domain            = string
    auth0_audience          = string
    auth0_m2m_client_id     = string
    auth0_m2m_client_secret = string
  })
}
