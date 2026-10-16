#!/bin/sh
set -eu

: "${ODOO_ADMIN_PASSWORD:?ODOO_ADMIN_PASSWORD is required}"
: "${ODOO_DB:?ODOO_DB is required}"
: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
export POSTGRES_PORT
ODOO_INIT_MODULE=crm_methodology
export ODOO_INIT_MODULE

# shellcheck source=odoo-entrypoint-lib.sh
. "$(dirname "$0")/odoo-entrypoint-lib.sh"

validate_identifier ODOO_DB "$ODOO_DB"
validate_identifier POSTGRES_USER "$POSTGRES_USER"
validate_hostname POSTGRES_HOST "$POSTGRES_HOST"
validate_port POSTGRES_PORT "$POSTGRES_PORT"
validate_single_line ODOO_ADMIN_PASSWORD "$ODOO_ADMIN_PASSWORD"
validate_single_line POSTGRES_PASSWORD "$POSTGRES_PASSWORD"

runtime_config=/tmp/odoo-runtime.conf
umask 077

# Render terminates TLS in front of the container and proxies a single
# public database, so behave as a proxied single-tenant deployment
# rather than the dev image's local multi-db defaults.
#
# Built with printf (not an unquoted heredoc) so a secret containing a literal `$`, backtick, or
# trailing backslash is never re-interpreted by the shell — build_runtime_config only ever reads
# this text from its stdin, it does not eval it.
{
    printf 'admin_passwd = %s\n' "$ODOO_ADMIN_PASSWORD"
    printf 'db_name = %s\n' "$ODOO_DB"
    printf 'db_host = %s\n' "$POSTGRES_HOST"
    printf 'db_port = %s\n' "$POSTGRES_PORT"
    printf 'db_user = %s\n' "$POSTGRES_USER"
    printf 'db_password = %s\n' "$POSTGRES_PASSWORD"
    printf 'proxy_mode = True\n'
    printf 'list_db = False\n'
} | build_runtime_config /etc/odoo/odoo.conf "$runtime_config"

# Render's free tier has no Pre-Deploy Command to run init as a separate step
# (see ADR 0006), so every boot checks the target database itself and heals
# a missing/expired one by initializing ODOO_INIT_MODULE with demo data before
# the server ever starts serving requests. ODOO_DB/POSTGRES_*/ODOO_INIT_MODULE
# are already in the environment (docker run -e, or exported above), so
# init_module_installed (odoo-entrypoint-lib.sh) inherits them without needing
# to be re-passed.
if ! init_module_installed; then
    echo "$ODOO_INIT_MODULE is not installed in database '$ODOO_DB' — initializing with demo data." >&2
    python3 /workspace/odoo-bin -i "$ODOO_INIT_MODULE" --with-demo --stop-after-init --config="$runtime_config"
fi

# Render's free web service has no persistent disk, so every deploy is a brand-new
# container with an empty ephemeral filesystem while Postgres (and the attachments
# recorded in it) persists. Force new/migrated attachments into DB-backed storage
# (see odoo/addons/base/models/ir_attachment.py's _storage()/force_storage()) and
# purge any existing row whose file storage is unreadable on this container, so it
# regenerates into DB storage on next request instead of 500ing forever.
heal_attachment_storage() {
    python3 - <<'PY'
import os
import sys

import psycopg2

try:
    conn = psycopg2.connect(
        dbname=os.environ["ODOO_DB"],
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
except psycopg2.OperationalError as exc:
    print(f"heal_attachment_storage: could not connect to Postgres, skipping: {exc}", file=sys.stderr)
    sys.exit(0)

with conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = 'ir_attachment'"
        )
        if cur.fetchone() is None:
            sys.exit(0)

        cur.execute(
            """
            INSERT INTO ir_config_parameter (key, value)
            VALUES ('ir_attachment.location', 'db')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """
        )

        filestore = os.path.join("/var/lib/odoo", "filestore", os.environ["ODOO_DB"])
        cur.execute(
            "SELECT id, store_fname FROM ir_attachment WHERE store_fname IS NOT NULL"
        )
        stale_ids = [
            attachment_id
            for attachment_id, store_fname in cur.fetchall()
            if not os.path.isfile(os.path.join(filestore, store_fname))
        ]
        if stale_ids:
            cur.execute("DELETE FROM ir_attachment WHERE id = ANY(%s)", (stale_ids,))
            print(
                f"Purged {len(stale_ids)} stale file-backed attachment row(s) "
                "missing from this container's filestore.",
                file=sys.stderr,
            )
PY
}

heal_attachment_storage

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
