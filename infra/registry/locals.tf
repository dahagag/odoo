locals {
  tags = merge(var.tags, {
    TofuModule = "registry"
  })

  # Fixed by ADR-0038's topology decision (one repository per image, namespaced under the
  # project) — not variables, since renaming any of these is a deliberate, separate decision,
  # not a per-environment knob.
  odoo_dev_repository_name                 = "agentic-erp/odoo-dev"
  odoo_prod_repository_name                = "agentic-erp/odoo-prod"
  tofu_runner_repository_name              = "agentic-erp/tofu-runner"
  administration_stack_api_repository_name = "agentic-erp/administration-stack-api"
}
