# Base AMI reference (ADR-0024): the baked snapshot (OS + Odoo + hosting/hosting_admin addons)
# that every Trial Org instance launches from. This is a lookup only — the AMI itself is baked
# by a separate pipeline, out of scope for this ticket.
data "aws_ami" "trial_org_base" {
  most_recent = true
  owners      = [var.base_ami_owner_account_id]

  filter {
    name   = "name"
    values = [var.base_ami_name_pattern]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}
