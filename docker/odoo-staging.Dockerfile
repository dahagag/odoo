ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

USER root

COPY requirements.txt /tmp/odoo-requirements.txt
COPY --chmod=0755 docker/pip-install-requirements.sh /tmp/pip-install-requirements.sh

RUN /tmp/pip-install-requirements.sh \
    && rm -rf /root/.cache /tmp/odoo-requirements.txt /tmp/pip-install-requirements.sh

# Same shape as docker/odoo-render.Dockerfile (#338's sibling production-style image): the base
# image already ships node/rtlcss/wkhtmltopdf; this one skips google-chrome (browser tests), ruff
# (lint) and npm (editor tooling) since none of that dev-only tooling runs in staging either.
#
# This file is intentionally a near-duplicate of docker/odoo-render.Dockerfile rather than one
# shared, build-arg-parameterized Dockerfile for both targets. docker/odoo-render.Dockerfile's
# path is wired into Render's own dashboard service config (ADR-0006), outside this repo and not
# visible/testable from here — editing it to also serve staging would risk a production Render
# deploy on a change this ticket (#341, CI wiring for dev.domain.com's staging Odoo) can't verify
# end to end. The two Dockerfiles differ by exactly one COPY (which entrypoint script becomes
# /usr/local/bin/odoo-*-entrypoint) and one ENTRYPOINT line; everything else — pip install layer,
# application tree, odoo.conf, chmod/chown — is identical on purpose so the two images stay easy
# to diff and keep in sync by inspection.
COPY --chown=odoo:odoo odoo-bin /workspace/odoo-bin
COPY --chown=odoo:odoo odoo/ /workspace/odoo/
COPY --chown=odoo:odoo addons/ /workspace/addons/
COPY --chown=odoo:odoo custom_addons/ /workspace/custom_addons/
COPY docker/odoo.conf /etc/odoo/odoo.conf
# odoo-staging-entrypoint.sh sources odoo-entrypoint-lib.sh from its own directory
# ($(dirname "$0")), so the shared lib is copied alongside it here under its own (renamed,
# extension-less) filename rather than only existing at its repo path — same convention
# docker/odoo-render.Dockerfile already uses.
COPY --chmod=0755 docker/odoo-entrypoint-lib.sh /usr/local/bin/odoo-entrypoint-lib.sh
COPY --chmod=0755 docker/odoo-staging-entrypoint.sh /usr/local/bin/odoo-staging-entrypoint

RUN chmod 0755 /workspace/odoo-bin && chown -R odoo:odoo /var/lib/odoo

WORKDIR /workspace
USER odoo
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/odoo-staging-entrypoint"]
