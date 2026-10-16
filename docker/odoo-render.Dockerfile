ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

USER root

COPY requirements.txt /tmp/odoo-requirements.txt
COPY --chmod=0755 docker/pip-install-requirements.sh /tmp/pip-install-requirements.sh

RUN /tmp/pip-install-requirements.sh \
    && rm -rf /root/.cache /tmp/odoo-requirements.txt /tmp/pip-install-requirements.sh

# The base image already ships node/rtlcss/wkhtmltopdf; unlike the dev image, this one
# skips google-chrome (browser tests), ruff (lint) and npm (editor tooling) since none
# of that dev-only tooling runs in production.
COPY --chown=odoo:odoo odoo-bin /workspace/odoo-bin
COPY --chown=odoo:odoo odoo/ /workspace/odoo/
COPY --chown=odoo:odoo addons/ /workspace/addons/
COPY --chown=odoo:odoo custom_addons/ /workspace/custom_addons/
COPY docker/odoo.conf /etc/odoo/odoo.conf
# odoo-render-entrypoint.sh sources odoo-entrypoint-lib.sh from its own directory
# ($(dirname "$0")), so the shared lib is copied alongside it here under its own
# (renamed, extension-less) filename rather than only existing at its repo path.
COPY --chmod=0755 docker/odoo-entrypoint-lib.sh /usr/local/bin/odoo-entrypoint-lib.sh
COPY --chmod=0755 docker/odoo-render-entrypoint.sh /usr/local/bin/odoo-render-entrypoint

RUN chmod 0755 /workspace/odoo-bin && chown -R odoo:odoo /var/lib/odoo

WORKDIR /workspace
USER odoo
EXPOSE 8069
ENTRYPOINT ["/usr/local/bin/odoo-render-entrypoint"]
