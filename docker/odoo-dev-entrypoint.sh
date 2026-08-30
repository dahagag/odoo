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
