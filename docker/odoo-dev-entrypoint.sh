#!/bin/sh
set -eu

if [ "${1:-}" != "odoo-source" ]; then
    exec "$@"
fi
shift

: "${ODOO_ADMIN_PASSWORD:?ODOO_ADMIN_PASSWORD is required}"
: "${ODOO_DB:?ODOO_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

validate_identifier() {
    case "$2" in
        ''|[!a-z]*|*[!a-z0-9_]*)
            echo "$1 must start with a lowercase letter and contain only lowercase letters, digits, and underscores." >&2
            exit 1
            ;;
    esac
}

validate_single_line() {
    if printf '%s' "$2" | LC_ALL=C grep -q '[[:cntrl:]]'; then
        echo "$1 must be a single-line value without control characters." >&2
        exit 1
    fi
}

validate_identifier ODOO_DB "$ODOO_DB"
validate_identifier POSTGRES_USER "$POSTGRES_USER"
validate_single_line ODOO_ADMIN_PASSWORD "$ODOO_ADMIN_PASSWORD"
validate_single_line POSTGRES_PASSWORD "$POSTGRES_PASSWORD"

runtime_config=/tmp/odoo-runtime.conf
umask 077
cp /etc/odoo/odoo.conf "$runtime_config"
{
    printf '\nadmin_passwd = %s\n' "$ODOO_ADMIN_PASSWORD"
    printf 'db_host = db\n'
    printf 'db_port = 5432\n'
    printf 'db_user = %s\n' "$POSTGRES_USER"
    printf 'db_password = %s\n' "$POSTGRES_PASSWORD"
} >> "$runtime_config"

# Per docs/adr/0012: `scripts/dev.sh init` only ever seeds `base,web` (a fresh DB
# shell), so a plain persistent-server boot also checks whether the addon this
# repo exists to develop is actually installed, and heals it with demo data if
# not — mirroring docker/odoo-render-entrypoint.sh's healing logic (ADR 0006) so
# local dev and the deployed demo can't silently drift apart on which apps are
# enabled. Skipped for `shell`/`scaffold`, and for any invocation already doing
# its own module lifecycle work (`scripts/dev.sh install/update/test`, which
# pass `--init=`/`--update=`/`--test-enable`/`--stop-after-init` against a
# database that isn't necessarily `$ODOO_DB`) so this never runs the check
# against the wrong database or duplicates that work.
ODOO_INIT_MODULE=crm_methodology
export ODOO_INIT_MODULE
run_heal=1
for arg in "$@"; do
    case "$arg" in
        shell|scaffold|--init=*|--update=*|--test-enable|--stop-after-init)
            run_heal=0
            ;;
    esac
done

init_module_installed() {
    python3 - <<'PY'
import os
import sys

import psycopg2

try:
    conn = psycopg2.connect(
        dbname=os.environ["ODOO_DB"],
        host="db",
        port=5432,
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
except psycopg2.OperationalError:
    sys.exit(1)

with conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = 'ir_module_module'"
        )
        if cur.fetchone() is None:
            sys.exit(1)
        cur.execute(
            "SELECT state FROM ir_module_module WHERE name = %s",
            (os.environ["ODOO_INIT_MODULE"],),
        )
        row = cur.fetchone()
        sys.exit(0 if row and row[0] == "installed" else 1)
PY
}

if [ "$run_heal" -eq 1 ] && ! init_module_installed; then
    echo "$ODOO_INIT_MODULE is not installed in database '$ODOO_DB' — initializing with demo data." >&2
    python3 /workspace/odoo-bin -i "$ODOO_INIT_MODULE" --database="$ODOO_DB" --with-demo --stop-after-init --config="$runtime_config"
fi

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
