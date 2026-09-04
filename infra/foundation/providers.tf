# Tagging convention: default_tags below applies local.tags to every resource this module
# creates automatically (the AWS provider merges it in at apply time), so individual resources
# only set their own `tags = merge(local.tags, {...})` when they need a tag beyond that common
# set (typically just `Name`) — never a bare `tags = local.tags`, which would be redundant with
# this block. infra/modules/trial_org has no provider of its own, so it can't rely on this and
# sets tags explicitly on every resource instead — see its locals.tf.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
