ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

ARG HOST_UID=1000
ARG HOST_GID=1000

USER root

COPY requirements.txt /tmp/odoo-requirements.txt
COPY --chmod=0755 docker/pip-install-requirements.sh /tmp/pip-install-requirements.sh

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && /tmp/pip-install-requirements.sh \
    && python3 -m pip install --no-cache-dir --break-system-packages ruff==0.16.1 \
    && npm install --global rtlcss \
    && wkhtmltopdf --version | grep -E '0\.12\.6' \
    && rtlcss --version \
    && ruff --version \
    && groupmod --non-unique --gid "${HOST_GID}" odoo \
    && usermod --non-unique --uid "${HOST_UID}" --gid "${HOST_GID}" odoo \
    && chown -R odoo:odoo /var/lib/odoo \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/odoo-requirements.txt /tmp/pip-install-requirements.sh

# Ubuntu's own "chromium" package is a snap-only stub on this base image (no real binary,
# and snap doesn't work in a minimal container), so HttpCase browser/tour tests need Google
# Chrome installed from its own apt repo instead. Odoo's test runner finds it automatically
# via `google-chrome-stable` on PATH.
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && google-chrome-stable --version \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=0755 docker/odoo-dev-entrypoint.sh /usr/local/bin/odoo-dev-entrypoint

WORKDIR /workspace
USER odoo
ENTRYPOINT ["/usr/local/bin/odoo-dev-entrypoint"]
