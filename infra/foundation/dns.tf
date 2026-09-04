# Route53 hosted zone for Trial Org DNS records (root_domain covers both the apex wildcard and
# the dev subdomain wildcard — a subdomain doesn't need its own delegated zone here since both
# live under the same parent).
resource "aws_route53_zone" "root" {
  name = var.root_domain
}

# ACM wildcard certificate covering both *.method.factory1.io and *.dev.method.factory1.io.
resource "aws_acm_certificate" "wildcard" {
  domain_name = "*.${var.root_domain}"
  subject_alternative_names = [
    var.root_domain,
    "*.${var.dev_subdomain}",
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "wildcard_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = aws_route53_zone.root.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.wildcard_cert_validation : r.fqdn]
}

# This zone is only authoritative for var.root_domain once its name servers (exported below as
# route53_name_servers, see outputs.tf) are delegated at the registrar or parent zone for
# var.root_domain. Until that manual, one-time delegation is done (tracked alongside the
# apply itself — see infra/README.md's "tofu apply is a deliberate human/ops action" section),
# ACM DNS validation above cannot complete and Trial Org DNS records written to this zone will
# not resolve publicly.
