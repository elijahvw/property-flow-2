variable "vars" {
  type = object({
    environment              = string
    cloudfront_origin_secret = string
    alb_dns_name             = string
  })
}
