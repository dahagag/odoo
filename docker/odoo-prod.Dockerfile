ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

USER root

COPY requirements.txt /tmp/odoo-requirements.txt
COPY --chmod=0755 docker/pip-install-requirements.sh /tmp/pip-install-requirements.sh

RUN /tmp/pip-install-requirements.sh \
    && rm -rf /root/.cache /tmp/odoo-requirements.txt /tmp/pip-install-requirements.sh

# The base image already ships node/rtlcss/wkhtmltopdf; this image skips google-chrome
# (browser tests), ruff (lint), and npm (editor tooling) since none of that dev-only
# tooling runs in production. Kept as its own file, separate from docker/odoo-dev.Dockerfile
# and the retired docker/odoo-render.Dockerfile, per ADR 0003's dev/non-dev separation.
COPY --chown=odoo:odoo odoo-bin /workspace/odoo-bin
COPY --chown=odoo:odoo odoo/ /workspace/odoo/
COPY --chown=odoo:odoo addons/ /workspace/addons/
COPY --chown=odoo:odoo custom_addons/ /workspace/custom_addons/
COPY docker/odoo-prod.conf /etc/odoo/odoo.conf

RUN chmod 0755 /workspace/odoo-bin && chown -R odoo:odoo /var/lib/odoo

WORKDIR /workspace
USER odoo
EXPOSE 8069
ENTRYPOINT ["/workspace/odoo-bin"]
CMD ["--config=/etc/odoo/odoo.conf"]
