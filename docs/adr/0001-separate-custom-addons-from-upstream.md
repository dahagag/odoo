# Separate custom addons from upstream

Repository-owned Odoo modules live under `custom_addons/`, while `odoo/` and `addons/` remain the upstream upgrade base and reference implementation. Direct upstream patches are exceptional because they increase merge and upgrade cost; each one requires explicit approval and a recorded reason that an extension module cannot satisfy.
