ARG ODOO_IMAGE=odoo:19.0-20260817
FROM ${ODOO_IMAGE}

USER root

COPY requirements.txt /tmp/odoo-requirements.txt
COPY --chmod=0755 docker/pip-install-requirements.sh /tmp/pip-install-requirements.sh

# requirements.txt only installs boto3 (a Python library); the entrypoint's drop-and-recreate
# and seed steps call the `aws` CLI binary itself (aws ssm get-parameter/get-parameters-by-path),
# which boto3 doesn't provide. Ubuntu Noble (this image's base) dropped the `awscli` apt package
# (no installation candidate) — installed via AWS's own v2 installer instead, which is a
# self-contained bundle and avoids any botocore version conflict with the pinned boto3 above.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(dpkg --print-architecture | sed 's/amd64/x86_64/;s/arm64/aarch64/').zip" -o /tmp/awscliv2.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/awscliv2.zip /tmp/aws

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
