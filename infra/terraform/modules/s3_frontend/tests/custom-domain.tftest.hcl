mock_provider "aws" {}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "123456789012"
  }
}

variables {
  vars = {
    environment              = "test"
    cloudfront_origin_secret = "isolated-test-origin-secret"
    alb_dns_name             = "test-alb.us-east-1.elb.amazonaws.com"
  }
}

run "existing_cloudfront_address" {
  command = plan
  assert {
    condition     = length(aws_cloudfront_distribution.s3_distribution.aliases) == 0 && aws_cloudfront_distribution.s3_distribution.viewer_certificate[0].cloudfront_default_certificate
    error_message = "Without a custom domain the existing distribution address and default certificate must remain available."
  }
}

run "custom_domain_on_same_distribution" {
  command = plan
  variables {
    custom_domain = {
      hostname        = "propertyflow.saasapps.cloud"
      certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
    }
  }
  assert {
    condition     = contains(aws_cloudfront_distribution.s3_distribution.aliases, "propertyflow.saasapps.cloud") && !aws_cloudfront_distribution.s3_distribution.viewer_certificate[0].cloudfront_default_certificate
    error_message = "The requested hostname must use the existing distribution with its custom certificate."
  }
  assert {
    condition     = aws_cloudfront_distribution.s3_distribution.viewer_certificate[0].acm_certificate_arn == var.custom_domain.certificate_arn && aws_cloudfront_distribution.s3_distribution.viewer_certificate[0].ssl_support_method == "sni-only" && aws_cloudfront_distribution.s3_distribution.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "The custom hostname must use its us-east-1 certificate and SNI/TLS 1.2."
  }
}

run "reject_certificate_in_wrong_region" {
  command = plan
  variables {
    custom_domain = {
      hostname        = "propertyflow.saasapps.cloud"
      certificate_arn = "arn:aws:acm:us-west-2:123456789012:certificate/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.custom_domain]
}

run "reject_url_instead_of_hostname" {
  command = plan
  variables {
    custom_domain = {
      hostname        = "https://propertyflow.saasapps.cloud/"
      certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012"
    }
  }
  expect_failures = [var.custom_domain]
}
