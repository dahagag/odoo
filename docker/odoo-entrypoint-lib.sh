# Shared helpers for this repo's Odoo entrypoints (docker/odoo-render-entrypoint.sh,
# docker/odoo-staging-entrypoint.sh). `sh`-compatible (no bashisms) and meant to be sourced, not
# executed directly — it defines functions only and has no side effects on its own.
#
# Kept as one file both entrypoints source so the validation rules and runtime-config
# construction can't drift between Render and staging (#338): a copy-pasted fix in one would
# silently not apply to the other.

validate_identifier() {
    case "$2" in
        ''|[!a-z]*|*[!a-z0-9_]*)
            echo "$1 must start with a lowercase letter and contain only lowercase letters, digits, and underscores." >&2
            exit 1
            ;;
    esac
}

validate_hostname() {
    case "$2" in
        ''|*[!A-Za-z0-9.-]*)
            echo "$1 must be a hostname or IP address containing only letters, digits, dots, and hyphens." >&2
            exit 1
            ;;
    esac
}

validate_port() {
    case "$2" in
        ''|*[!0-9]*)
            echo "$1 must be a numeric port." >&2
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

# Builds a runtime odoo.conf at $2 by copying the base config at $1, then applying the
# newline-separated `key = value` overrides read from stdin: any key the base config already
# sets is dropped first (odoo.conf ships dev-oriented defaults that would otherwise collide as
# duplicate config keys), then the overrides are appended. Callers are expected to have already
# set a restrictive umask (both entrypoints do this themselves, right before calling this, so the
# admin/db credentials below land in a mode-0600 file).
build_runtime_config() {
    base_conf="$1"
    runtime_config="$2"
    overrides="$(cat)"

    cp "$base_conf" "$runtime_config"

    override_keys=$(printf '%s\n' "$overrides" | sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\1/p' | tr '\n' '|' | sed -E 's/\|$//')
    sed -i -E "/^[[:space:]]*($override_keys)[[:space:]]*=/d" "$runtime_config"
    printf '\n%s\n' "$overrides" >> "$runtime_config"
}

# Checks whether $ODOO_INIT_MODULE is installed in $ODOO_DB, connecting with the
# POSTGRES_HOST/POSTGRES_PORT/POSTGRES_USER/POSTGRES_PASSWORD already in the environment. Exits
# (via the subshell's own exit status, not `exit`) 0 if installed, 1 otherwise — including when
# the database doesn't exist yet, or exists but hasn't been initialized by Odoo at all.
init_module_installed() {
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
