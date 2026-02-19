variable "vars" {
  type = object({
    environment = string
    vpc_cidr    = string
  })
}
