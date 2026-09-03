#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "$SCRIPT_DIR" != "${BASH_SOURCE[0]}" ]] || SCRIPT_DIR='.'
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMMAND="${1:-}"
ARGUMENT="${2:-}"
EXTRA="${3:-}"
CLEANUP_OPTION="${4:-}"
COMPOSE=()

usage() {
    echo "Usage: scripts/dev.sh {doctor|build|init|up|down|logs|shell|db-shell|scaffold|install|update|test|lint|docs-build|docs-build:doc|docs-build:parity|docs-build:video|reset} [argument] [extra] [option]" >&2
    exit "${1:-2}"
}

resolve_compose() {
    if ((${#COMPOSE[@]})); then return; fi
    if ! command -v docker >/dev/null 2>&1; then
        echo "Docker is not installed or is not available on PATH." >&2
        exit 1
    fi
    if docker compose version >/dev/null 2>&1; then
        COMPOSE=(docker compose)
    elif command -v docker-compose >/dev/null 2>&1; then
        COMPOSE=(docker-compose)
    else
        echo "Docker Compose is unavailable. Install the plugin or standalone docker-compose." >&2
        exit 1
    fi
}

compose() {
    resolve_compose
    "${COMPOSE[@]}" "$@"
}

require_env() {
    if [[ ! -f .env ]]; then
        echo "Missing .env. Copy .env.example to .env, review the development-only credentials, and retry." >&2
        exit 1
    fi
}

setting() {
    local name="$1" default="$2" value
    value="$(sed -n -E "s/^[[:space:]]*${name}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\1/p" .env | tail -n 1)"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "${value:-$default}"
}

assert_identifier() {
    local value="$1" label="$2"
    if [[ ! "$value" =~ ^[a-z][a-z0-9_]*$ ]]; then
        echo "$label '$value' must start with a lowercase letter and contain only lowercase letters, digits, and underscores." >&2
        exit 1
    fi
}

assert_module() {
    local module="$1" must_exist="${2:-false}"
    [[ -n "$module" ]] || { echo "A module name is required." >&2; exit 1; }
    assert_identifier "$module" "Module name"
    if [[ "$must_exist" == true && ! -f "custom_addons/$module/__manifest__.py" ]]; then
        echo "Owned module '$module' was not found under custom_addons/." >&2
        exit 1
    fi
}

resolve_host_python() {
    # docs-build:video shells out to the HyperFrames CLI (npx hyperframes render),
    # which needs the local ffmpeg/ffprobe/Chrome-Headless-Shell toolchain
    # installed on the host (see issue #36) - none of that is in the Odoo dev
    # image, so unlike every other subcommand here, this one runs on the host,
    # not via compose.
    # Windows ships App Execution Alias stubs for python/python3 that satisfy
    # `command -v` but only print a "Python was not found" hint and exit 49, so
    # probe that each candidate actually runs before trusting it - otherwise
    # docs-build:video silently renders nothing on a machine whose real
    # interpreter is installed under a different name.
    local candidate
    for candidate in python3 python py; do
        command -v "$candidate" >/dev/null 2>&1 || continue
        "$candidate" -c '' >/dev/null 2>&1 || continue
        printf '%s
' "$candidate"
        return 0
    done
    return 1
}

assert_relative_path() {
    local path="$1" label="$2"
    [[ -n "$path" ]] || { echo "$label requires a path argument." >&2; exit 1; }
    [[ "$path" != /* && "/$path/" != *"/../"* ]] || { echo "$label path must be a relative path inside the repository." >&2; exit 1; }
    [[ -e "$path" ]] || { echo "$label path '$path' does not exist." >&2; exit 1; }
}

docs_build_doc() {
    local argument="$1" docs_build_doc_args=()
    if [[ -n "$argument" ]]; then
        assert_relative_path "$argument" "docs-build:doc"
        docs_build_doc_args=("$argument")
    fi
    compose run --rm --no-deps odoo python3 -m scripts.docs_build.cli "${docs_build_doc_args[@]}"
}

docs_build_parity() {
    compose run --rm --no-deps odoo python3 -m scripts.docs_build.parity_cli
}

docs_build_video() {
    local project_path="$1" host_python
    assert_relative_path "$project_path" "docs-build:video"
    # resolve_host_python runs in a subshell here, so it reports failure through
    # its exit status rather than exiting the script itself.
    if ! host_python="$(resolve_host_python)"; then
        echo "docs-build:video needs a working Python interpreter (python3/python/py) on PATH." >&2
        exit 1
    fi
    "$host_python" -m scripts.docs_build.video_cli "$project_path"
}

# Authored HyperFrames projects live at docs/teach/videos/<stem>/ (see
# scripts/docs_build/video_cli.py and docs/adr/0008) - one per teach doc that has
# a walkthrough video authored for it. Bare `docs-build` re-renders every one it
# finds; a teach doc with no authored project simply has no video.
docs_build_video_projects() {
    local videos_dir="docs/teach/videos"
    [[ -d "$videos_dir" ]] || return 0
    find "$videos_dir" -mindepth 2 -maxdepth 2 -name hyperframes.json -print0 |
        while IFS= read -r -d '' manifest; do
            dirname "$manifest"
        done |
        sort
}

start_database() {
    local user attempt consecutive=0
    compose up -d db
    user="$(setting POSTGRES_USER odoo)"
    for attempt in $(seq 1 60); do
        # On a fresh volume, Postgres' entrypoint briefly runs a temporary server to apply init
        # scripts, stops it, then starts the real one; pg_isready can report ready during that
        # temporary server's short life. Require two ready checks a second apart so a restart in
        # between is caught (the counter resets) instead of returning into that shutdown window.
        if compose exec -T db pg_isready -U "$user" -d postgres >/dev/null 2>&1; then
            consecutive=$((consecutive + 1))
            if [[ "$consecutive" -ge 2 ]]; then return; fi
        else
            consecutive=0
        fi
        sleep 1
    done
    echo "PostgreSQL did not become healthy within 60 seconds. Run the logs command for details." >&2
    exit 1
}

odoo_run() {
    compose run --rm --no-deps odoo odoo-source "$@"
}

initialize_database() {
    local database user exists initialized
    start_database
    database="$(setting ODOO_DB agentic_erp_dev)"
    user="$(setting POSTGRES_USER odoo)"
    assert_identifier "$database" "Database name"
    exists="$(compose exec -T db psql -U "$user" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$database'")"
    if [[ "$exists" != 1 ]]; then
        compose exec -T db createdb -U "$user" "$database"
    fi
    initialized="$(compose exec -T db psql -U "$user" -d "$database" -tAc "SELECT CASE WHEN to_regclass('public.ir_module_module') IS NOT NULL THEN 1 ELSE 0 END")"
    if [[ "$initialized" == 1 ]]; then
        echo "Database '$database' is already initialized."
        return
    fi
    odoo_run "--database=$database" --init=base,web --without-demo --stop-after-init
    echo "Initialized development database '$database'."
}

module_lifecycle() {
    local module="$1" mode="$2" database lifecycle_switch result
    assert_module "$module" true
    initialize_database
    database="$(setting ODOO_DB agentic_erp_dev)"
    assert_identifier "$database" "Database name"
    compose stop odoo >/dev/null 2>&1 || true
    lifecycle_switch="--init=$module"
    [[ "$mode" == update ]] && lifecycle_switch="--update=$module"
    set +e
    odoo_run "--database=$database" "$lifecycle_switch" --stop-after-init
    result=$?
    set -e
    compose up -d odoo || true
    return "$result"
}

module_test() {
    local module="$1" tags="$2" cleanup="$3" user prefix stamp test_database result
    assert_module "$module" true
    if [[ -n "$cleanup" && "$cleanup" != --cleanup-on-failure ]]; then
        echo "Unknown test option '$cleanup'. Expected --cleanup-on-failure." >&2
        exit 2
    fi
    start_database
    user="$(setting POSTGRES_USER odoo)"
    prefix="$(setting ODOO_TEST_DB_PREFIX agentic_erp_test)"
    assert_identifier "$prefix" "Test database prefix"
    stamp="$(date -u +%Y%m%d%H%M%S)"
    test_database="${prefix}_${stamp}_$$"
    assert_identifier "$test_database" "Test database name"
    [[ -n "$tags" ]] || tags="/$module"
    compose exec -T db createdb -U "$user" "$test_database"
    set +e
    odoo_run "--database=$test_database" "--init=$module" --without-demo \
        --test-enable "--test-tags=$tags" --stop-after-init --log-level=test
    result=$?
    set -e
    if ((result == 0)); then
        compose exec -T db dropdb -U "$user" "$test_database"
        echo "Tests passed; removed ephemeral database '$test_database'."
        return
    fi
    if [[ "$cleanup" == --cleanup-on-failure ]]; then
        compose exec -T db dropdb -U "$user" "$test_database"
        echo "Tests failed with exit code $result. Removed database '$test_database' as requested." >&2
    else
        echo "Tests failed with exit code $result. Preserved database '$test_database' for investigation." >&2
    fi
    exit "$result"
}

doctor() {
    local path server_version http_port gevent_port running_services port
    resolve_compose
    for path in compose.yaml docker/odoo-dev.Dockerfile docker/odoo.conf .env.example custom_addons/README.md; do
        [[ -e "$path" ]] || { echo "Missing required development file: $path" >&2; exit 1; }
    done
    server_version="$(docker info --format '{{.ServerVersion}}' 2>/dev/null || true)"
    [[ -n "$server_version" ]] || { echo "The Docker engine is not running. Start Docker Desktop/Engine and retry." >&2; exit 1; }
    http_port="$(setting ODOO_HTTP_PORT 8069)"
    gevent_port="$(setting ODOO_GEVENT_PORT 8072)"
    [[ "$http_port" =~ ^[0-9]+$ && "$http_port" -ge 1 && "$http_port" -le 65535 ]] || { echo "Invalid ODOO_HTTP_PORT." >&2; exit 1; }
    [[ "$gevent_port" =~ ^[0-9]+$ && "$gevent_port" -ge 1 && "$gevent_port" -le 65535 ]] || { echo "Invalid ODOO_GEVENT_PORT." >&2; exit 1; }
    running_services="$(compose ps --status running --services)"
    if ! grep -qx 'odoo' <<<"$running_services"; then
        for port in "$http_port" "$gevent_port"; do
            if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
                echo "Localhost port $port is already occupied. Change the corresponding value in .env." >&2
                exit 1
            fi
        done
    fi
    compose config --quiet
    echo "Doctor passed: Docker $server_version, HTTP $http_port, gevent $gevent_port."
}

case "$COMMAND" in
    --help|-h) usage 0 ;;
    '') usage ;;
esac
require_env

case "$COMMAND" in
    doctor) doctor ;;
    build) compose build odoo ;;
    init) initialize_database ;;
    up) start_database; compose up -d odoo ;;
    down) compose down ;;
    logs) compose logs --follow odoo ;;
    shell)
        start_database
        database="$(setting ODOO_DB agentic_erp_dev)"
        compose run --rm --no-deps odoo odoo-source shell "--database=$database"
        ;;
    db-shell)
        start_database
        compose exec db psql -U "$(setting POSTGRES_USER odoo)" -d "$(setting ODOO_DB agentic_erp_dev)"
        ;;
    scaffold)
        assert_module "$ARGUMENT"
        for root in odoo/addons addons custom_addons; do
            [[ ! -e "$root/$ARGUMENT" ]] || { echo "Module '$ARGUMENT' already exists under $root." >&2; exit 1; }
        done
        compose run --rm --no-deps odoo python3 /workspace/odoo-bin scaffold "$ARGUMENT" /workspace/custom_addons
        ;;
    install) module_lifecycle "$ARGUMENT" install ;;
    update) module_lifecycle "$ARGUMENT" update ;;
    test) module_test "$ARGUMENT" "$EXTRA" "$CLEANUP_OPTION" ;;
    lint)
        lint_path="${ARGUMENT:-custom_addons}"
        assert_relative_path "$lint_path" "Lint"
        ruff_options=()
        case "$(uname -s)" in
            CYGWIN*|MINGW*|MSYS*) ruff_options=(--ignore EXE002) ;;
        esac
        compose run --rm --no-deps odoo ruff check "${ruff_options[@]}" "/workspace/$lint_path"
        ;;
    docs-build)
        docs_build_doc ""
        while IFS= read -r project; do
            [[ -n "$project" ]] || continue
            docs_build_video "$project"
        done < <(docs_build_video_projects)
        ;;
    docs-build:doc) docs_build_doc "$ARGUMENT" ;;
    docs-build:parity) docs_build_parity ;;
    docs-build:video) docs_build_video "$ARGUMENT" ;;
    reset)
        project="$(setting COMPOSE_PROJECT_NAME agentic-erp-dev)"
        [[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "Unsafe Compose project name '$project'." >&2; exit 1; }
        echo "WARNING: this permanently removes the local development database and filestore." >&2
        echo "Project: $project"
        echo "Volumes: ${project}_postgres_data, ${project}_odoo_data"
        read -r -p "Type '$project' to confirm: " confirmation
        [[ "$confirmation" == "$project" ]] || { echo "Reset cancelled." >&2; exit 1; }
        compose down --volumes --remove-orphans
        ;;
    *) usage ;;
esac
