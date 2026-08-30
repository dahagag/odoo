ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

ARG HOST_UID=1000
ARG HOST_GID=1000

USER root

COPY requirements.txt /tmp/odoo-requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && python3 -m pip install --no-cache-dir --break-system-packages -r /tmp/odoo-requirements.txt \
    && python3 -m pip install --no-cache-dir --break-system-packages ruff==0.16.1 \
    && npm install --global rtlcss \
    && wkhtmltopdf --version | grep -E '0\.12\.6' \
    && rtlcss --version \
    && ruff --version \
    && groupmod --non-unique --gid "${HOST_GID}" odoo \
    && usermod --non-unique --uid "${HOST_UID}" --gid "${HOST_GID}" odoo \
    && chown -R odoo:odoo /var/lib/odoo \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/odoo-requirements.txt

COPY --chmod=0755 docker/odoo-dev-entrypoint.sh /usr/local/bin/odoo-dev-entrypoint

WORKDIR /workspace
USER odoo
ENTRYPOINT ["/usr/local/bin/odoo-dev-entrypoint"]
