#!/bin/sh
set -eu

# dev.domain.com staging entrypoint (#338, ADR-0040/ADR-0041). Every boot drops and recreates
# the database in place, then falls through into the same self-heal install check
# docker/odoo-render-entrypoint.sh already uses (ADR-0012's reasoning, reused here rather than
# reinvented), then seeds early-adopter/stakeholder account passwords from SSM SecureString
# parameters. Accepted trade-off (#203/ADR-0041): a failed seed leaves staging without a
# database — a redeploy is the recovery, so nothing here retries or rolls back a partial run.
#
# Env vars this entrypoint reads — all wired by infra/staging-odoo (#337):
#   ODOO_DB, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST (default 127.0.0.1, the in-task
#   postgres container reached over the shared Fargate task ENI's loopback), POSTGRES_PORT
#   (default 5432), AWS_REGION, ODOO_ADMIN_PASSWORD_SSM_PARAMETER (parameter name),
#   SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH (parameter path prefix).

: "${ODOO_DB:?ODOO_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${ODOO_ADMIN_PASSWORD_SSM_PARAMETER:?ODOO_ADMIN_PASSWORD_SSM_PARAMETER is required}"
: "${SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH:?SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH is required}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
export POSTGRES_HOST
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_PORT
# dev_e2e_smoke_test depends on crm_methodology (custom_addons/dev_e2e_smoke_test/__manifest__.py),
# so installing it still pulls crm_methodology in as a dependency. Installing crm_methodology
# alone, with dev_e2e_smoke_test absent, left #342's post-deploy smoke check unable to find any
# dev_e2e_smoke_test_post_deploy-tagged tests to run — Odoo then reports 0 post-tests and exits
# 0, so a broken deploy could pass the one check meant to catch it.
ODOO_INIT_MODULE=dev_e2e_smoke_test
export ODOO_INIT_MODULE

# shellcheck source=odoo-entrypoint-lib.sh
. "$(dirname "$0")/odoo-entrypoint-lib.sh"

validate_identifier ODOO_DB "$ODOO_DB"
validate_identifier POSTGRES_USER "$POSTGRES_USER"
validate_hostname POSTGRES_HOST "$POSTGRES_HOST"
validate_port POSTGRES_PORT "$POSTGRES_PORT"
validate_single_line POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
validate_single_line ODOO_ADMIN_PASSWORD_SSM_PARAMETER "$ODOO_ADMIN_PASSWORD_SSM_PARAMETER"
validate_single_line SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH "$SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH"

# The admin password itself is a real secret (infra/staging-odoo/variables.tf's
# odoo_admin_password_ssm_parameter_name) read by this entrypoint — not an ECS-native container
# `secret`, since it's applied post-install the same way the seed-account passwords are, not just
# injected as an env var at container start. Needed before the runtime config is written below,
# since admin_passwd must be in place before the server (or the install step) ever starts.
ODOO_ADMIN_PASSWORD=$(
    aws ssm get-parameter \
        --name "$ODOO_ADMIN_PASSWORD_SSM_PARAMETER" \
        --with-decryption \
        --region "$AWS_REGION" \
        --query 'Parameter.Value' \
        --output text
)
validate_single_line ODOO_ADMIN_PASSWORD "$ODOO_ADMIN_PASSWORD"

runtime_config=/tmp/odoo-runtime.conf
umask 077

# No reverse proxy sits in front of this container (ADR-0040: no ALB, no WAFv2 — the Tailscale
# sidecar reaches it directly over the task's shared loopback), so unlike
# docker/odoo-render-entrypoint.sh this does NOT set proxy_mode (that would mean trusting
# X-Forwarded-* headers from whatever actually connects, with nothing terminating TLS in front to
# justify it). list_db stays disabled regardless — one single-tenant database per task either way.
{
    printf 'admin_passwd = %s\n' "$ODOO_ADMIN_PASSWORD"
    printf 'db_name = %s\n' "$ODOO_DB"
    printf 'db_host = %s\n' "$POSTGRES_HOST"
    printf 'db_port = %s\n' "$POSTGRES_PORT"
    printf 'db_user = %s\n' "$POSTGRES_USER"
    printf 'db_password = %s\n' "$POSTGRES_PASSWORD"
    printf 'list_db = False\n'
} | build_runtime_config /etc/odoo/odoo.conf "$runtime_config"

# Drop and recreate the database before the self-heal check below (ADR-0041: "dropped and
# recreated in place before boot, then reseeded"). `DROP DATABASE IF EXISTS` is itself idempotent
# against a not-yet-existent database (ADR-0041's Testing section: "including the case where the
# previous database does not exist"), so no extra existence check is needed; this task's own
# in-task postgres container is freshly started for every deploy (never shared with a previous
# task), so there are no other sessions to worry about other than this entrypoint's own — the
# backend-termination step below is defensive, not load-bearing.
drop_and_recreate_database() {
    python3 - <<'PY'
import os

import psycopg2
from psycopg2 import sql

conn = psycopg2.connect(
    dbname="postgres",
    host=os.environ["POSTGRES_HOST"],
    port=os.environ["POSTGRES_PORT"],
    user=os.environ["POSTGRES_USER"],
    password=os.environ["POSTGRES_PASSWORD"],
)
conn.autocommit = True
db_name = os.environ["ODOO_DB"]

with conn.cursor() as cur:
    cur.execute(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
        " WHERE datname = %s AND pid <> pg_backend_pid()",
        (db_name,),
    )
    cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(db_name)))
    cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
PY
}

echo "Dropping and recreating database '$ODOO_DB' for a fresh boot." >&2
drop_and_recreate_database

# Reused verbatim from docker/odoo-render-entrypoint.sh via odoo-entrypoint-lib.sh: the drop and
# recreate above means this is always false right after boot, so this unconditionally installs
# ODOO_INIT_MODULE with demo data — kept as the same check (not a bare unconditional install) so
# the two entrypoints can never drift on what "installed" means.
if ! init_module_installed; then
    echo "$ODOO_INIT_MODULE is not installed in database '$ODOO_DB' — initializing with demo data." >&2
    python3 /workspace/odoo-bin -i "$ODOO_INIT_MODULE" --with-demo --stop-after-init --config="$runtime_config"
fi

# Seed early-adopter/stakeholder account passwords (ADR-0041): every password SecureString
# parameter under SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH is applied, post-install, onto the
# res.users record whose login matches that parameter's own final path segment (e.g.
# ".../seed-accounts/priya" seeds the login "priya") — crm_methodology's seed data (#339) is
# expected to create these logins as that same final path segment, so adding/removing a named
# account is a data-file change plus an SSM parameter, never a Terraform or entrypoint change.
# Passwords are never written to disk; they're only ever held in-process, matching how
# ODOO_ADMIN_PASSWORD/POSTGRES_PASSWORD already flow through this same entrypoint.
#
# Also neutralizes Odoo's own stock demo credentials (Security Architecture Review, PR #346):
# odoo/addons/base/data/res_users_data.xml unconditionally creates login "admin"/password
# "admin" (not demo-gated), and --with-demo additionally creates login "demo"/password "demo"
# (res_users_demo.xml) — both well-known defaults, both otherwise reachable by anyone on the
# tailnet (ADR-0040 puts every access tier, including early-adopters, on the same network path),
# and both re-created fresh on every deploy since the database is dropped and recreated each
# time (unlike a one-time install). ODOO_ADMIN_PASSWORD only sets odoo.conf's admin_passwd (the
# database-manager master password) — a different thing from the "admin" res.users login's own
# password, which nothing else here ever touches. This is exactly the bypass #339's own tiered
# access model (early-adopter/stakeholder groups, never base.group_user) exists to prevent.
seed_account_passwords() {
    accounts_json=$(
        aws ssm get-parameters-by-path \
            --path "$SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH" \
            --with-decryption \
            --recursive \
            --region "$AWS_REGION" \
            --query 'Parameters[].{Name:Name,Value:Value}' \
            --output json
    )

    SEED_ACCOUNTS_JSON="$accounts_json" SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH="$SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH" \
        ODOO_ADMIN_PASSWORD="$ODOO_ADMIN_PASSWORD" \
        python3 /workspace/odoo-bin shell --config="$runtime_config" --database="$ODOO_DB" --no-http <<'PY'
import json
import os
import re
import sys

accounts = json.loads(os.environ["SEED_ACCOUNTS_JSON"])
path_prefix = os.environ["SEED_ACCOUNT_PASSWORD_SSM_PARAMETER_PATH"].rstrip("/")

control_chars = re.compile(r"[\x00-\x1f\x7f]")
missing_logins = []
updated = 0

if not accounts:
    print(
        f"No seed-account parameters found under {path_prefix} — skipping account seeding.",
        file=sys.stderr,
    )

for entry in accounts:
    name = entry["Name"]
    login = name[len(path_prefix) + 1:]
    password = entry["Value"]

    if control_chars.search(password):
        sys.exit(f"Seed-account password for login '{login}' must be a single-line value without control characters.")

    user = env["res.users"].sudo().search([("login", "=", login)], limit=1)
    if not user:
        missing_logins.append(login)
        continue

    user.write({"password": password})
    updated += 1

if missing_logins:
    sys.exit(
        "No res.users match for seed-account login(s): "
        + ", ".join(missing_logins)
        + " — seed data (crm_methodology) and SSM parameters have drifted apart."
    )

# Neutralize Odoo's own stock demo credentials - reuse the already-provisioned admin secret
# for "admin" (one fewer secret to provision) and deactivate "demo" entirely (nobody needs a
# stock demo salesperson login on dev.domain.com). An empty seed-accounts path must never skip
# this (caught live: an earlier draft's early sys.exit(0) on an empty accounts list skipped this
# entirely) - fixed by removing that early return, so this is unreachable only via the same
# sys.exit paths above (a malformed password or a missing seed login), which abort the whole
# entrypoint under set -eu before Odoo ever starts serving, so stock credentials are never left
# reachable live either way.
Users = env["res.users"].sudo()
admin_user = Users.search([("login", "=", "admin")], limit=1)
if admin_user:
    admin_user.write({"password": os.environ["ODOO_ADMIN_PASSWORD"]})
demo_user = Users.search([("login", "=", "demo")], limit=1)
if demo_user:
    demo_user.write({"active": False})

env.cr.commit()
print(f"Seeded {updated} account password(s); reset admin/demo stock credentials.", file=sys.stderr)
PY
}

echo "Seeding early-adopter/stakeholder account passwords." >&2
seed_account_passwords

case "${1:-}" in
    ''|-*)
        exec python3 /workspace/odoo-bin server --config="$runtime_config" "$@"
        ;;
    *)
        command_name=$1
        shift
        exec python3 /workspace/odoo-bin "$command_name" --config="$runtime_config" "$@"
        ;;
esac
