variable "vars" {
  type = object({
    environment  = string
    alb_dns_name = string
  })
}
