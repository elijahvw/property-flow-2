variable "vars" {
  type = object({
    environment              = string
    cloudfront_origin_secret = string
    alb_dns_name             = string
  })
}

variable "custom_domain" {
  description = "Optional public hostname and its issued ACM certificate in us-east-1."
  type = object({
    hostname        = string
    certificate_arn = string
  })
  default = null
  validation {
    condition = var.custom_domain == null ? true : (
      can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.custom_domain.hostname)) &&
      length(var.custom_domain.hostname) <= 253 &&
      can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[a-f0-9-]+$", var.custom_domain.certificate_arn))
    )
    error_message = "Use a lowercase DNS hostname without a scheme/path and an ACM certificate ARN from us-east-1."
  }
}
