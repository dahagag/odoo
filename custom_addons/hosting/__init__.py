from . import models


def _post_init_sync_org_registration(env):
    # A freshly-installed instance shows a stated reason rather than an empty list until the
    # first cron tick (issue #201's User Story #5: "a clear message ... so that a blank panel is
    # not mistaken for an empty org") - this runs the same sync the cron does, once, right after
    # install.
    env['hosting.org.registration']._sync_from_stack()
