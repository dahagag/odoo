# Local Odoo 19 Development

The supported local environment runs this checkout and PostgreSQL in Linux containers. It is disposable development infrastructure, not a production deployment design. See `docs/adr/0003-standardize-local-development-on-containers.md`.

## Prerequisites

### Windows

- Docker Desktop with the Linux/WSL2 engine running.
- Git and PowerShell 7.
- The wrapper supports either `docker compose` or standalone `docker-compose`.

The standard path does not require host PostgreSQL, Python, Node, `rtlcss`, or `wkhtmltopdf` installations.

### Linux and macOS

- Docker Engine or Docker Desktop with Compose.
- Git and a POSIX shell with Bash.

Odoo 19 supports Python 3.10 through 3.14 and PostgreSQL 13 or later in this checkout. The development image pins an Odoo 19 image line, installs this checkout's Python requirements and Ruff version, and verifies `rtlcss` and `wkhtmltopdf` during the build. See the [official source-install reference](https://www.odoo.com/documentation/19.0/administration/on_premise/source.html).

## First run

From the repository root:

```powershell
Copy-Item .env.example .env
./scripts/dev.ps1 doctor
./scripts/dev.ps1 build
./scripts/dev.ps1 init
./scripts/dev.ps1 up
```

Or with Bash:

```bash
cp .env.example .env
# On Linux, set HOST_UID=$(id -u) and HOST_GID=$(id -g) in .env.
bash scripts/dev.sh doctor
bash scripts/dev.sh build
bash scripts/dev.sh init
bash scripts/dev.sh up
```

Open `http://localhost:8069`. A freshly initialized base database uses the local login `admin` / `admin`; change it if the database will contain anything worth protecting. `ODOO_ADMIN_PASSWORD` is the database-manager master password, not that user's login password. Values in `.env.example` are intentionally development-only. Change them for any non-disposable environment, and use a real secret manager outside local development.

## Runtime layout

- `db` runs PostgreSQL and persists its cluster in the Compose project's `postgres_data` volume. PostgreSQL has no host port.
- `odoo` bind-mounts the checkout at `/workspace` and runs `/workspace/odoo-bin`, so the active Git revision is the executed server source.
- Its entrypoint validates the local database identifiers and writes database credentials plus the file-only `admin_passwd` setting to a mode-`0600` runtime configuration inside the container; secrets are not process arguments or tracked files.
- The image maps its `odoo` user to `HOST_UID` and `HOST_GID` so files scaffolded into a Linux bind mount remain owned by the developer. The default `1000:1000` suits common Linux installations and is harmless under Docker Desktop; adjust it before `build` when needed.
- The Odoo filestore persists in the `odoo_data` volume.
- `docker/odoo.conf` includes `/workspace/odoo/addons`, `/workspace/addons`, and `/workspace/custom_addons` in `addons_path`.
- On a brand-new checkout, Odoo may report `custom_addons` as an invalid addon directory until the first module is scaffolded. Odoo 19 recognizes an addon path only after it contains a child directory with both `__init__.py` and `__manifest__.py`; the wrapper's `scaffold` command creates that structure.
- HTTP and gevent ports bind to localhost only and can be changed in `.env`.
- `ODOO_DEV_MODE=qweb,xml` reads XML views from source and enables QWeb diagnostics without making Docker Desktop recursively register file watches across every upstream addon. Python changes require `docker compose restart odoo` (or `down` followed by `up`). Native Linux users may opt into `qweb,xml,reload`; expect a slower first startup while Odoo registers every addon tree.

`down` removes containers and the project network while preserving both data volumes. `reset` removes only this Compose project's containers, network, database volume, and filestore volume after the user types the exact project name.

## Commands

Use `./scripts/dev.ps1 <command>` on PowerShell or `bash scripts/dev.sh <command>` on a POSIX host.

| Command | Behavior |
| --- | --- |
| `doctor` | Checks required files, Compose, the Docker engine, configured port ranges, and the resolved Compose model. |
| `build` | Builds the Odoo development image and verifies its development tools. |
| `init` | Starts PostgreSQL and creates the configured base/web database if it does not already exist. |
| `up` | Starts PostgreSQL and Odoo in the background. |
| `down` | Stops the stack without deleting local data. |
| `logs` | Follows Odoo server logs. |
| `shell` | Opens an Odoo shell in the development database. |
| `db-shell` | Opens `psql` inside the database container. |
| `scaffold <module>` | Validates a new module name and scaffolds it under `custom_addons/`. |
| `install <module>` | Installs an owned module, then returns the development server to its normal state. |
| `update <module>` | Upgrades an owned module with `--stop-after-init`, then restarts the development server. |
| `test <module> [tags] [cleanup option]` | Runs focused tests in a unique database. Passing databases are dropped; failed databases are preserved and named unless exact cleanup is requested. |
| `lint [path]` | Runs Ruff, defaulting to `custom_addons/`. The path must stay inside the repository. |
| `docs-build:doc <file>` | Renders one `docs/teach/*.md` entry file, plus the closure of every local `.md` file it links to (transitively), into self-contained static HTML pages under `custom_addons/crm_methodology/static/docs/` with internal links rewritten to match (see docs/adr/0007, [#35](https://github.com/dahagag/odoo/issues/35), [#38](https://github.com/dahagag/odoo/issues/38)). |
| `reset` | Displays exact project volume names and requires the project name before deleting local data. |

Examples:

```powershell
./scripts/dev.ps1 scaffold service_dispatch
./scripts/dev.ps1 install service_dispatch
./scripts/dev.ps1 update service_dispatch
./scripts/dev.ps1 test service_dispatch
./scripts/dev.ps1 test service_dispatch '/service_dispatch:TestDispatch.test_assignment'
./scripts/dev.ps1 test service_dispatch '/service_dispatch' -CleanupOnFailure
./scripts/dev.ps1 lint custom_addons/service_dispatch
./scripts/dev.ps1 docs-build:doc docs/teach/methodologies.md
```

```bash
bash scripts/dev.sh scaffold service_dispatch
bash scripts/dev.sh install service_dispatch
bash scripts/dev.sh update service_dispatch
bash scripts/dev.sh test service_dispatch
bash scripts/dev.sh test service_dispatch '/service_dispatch:TestDispatch.test_assignment'
bash scripts/dev.sh test service_dispatch '/service_dispatch' --cleanup-on-failure
bash scripts/dev.sh lint custom_addons/service_dispatch
bash scripts/dev.sh docs-build:doc docs/teach/methodologies.md
```

## Module lifecycle

Owned addons live under `custom_addons/`; read `docs/agents/odoo-19-development.md` before implementation. The lifecycle wrappers temporarily stop the normal Odoo service before installing or updating a module so two server processes do not mutate the same registry concurrently.

Odoo's generic scaffold is a starting point and may need formatting before its first successful lint run. On Windows Docker Desktop, bind-mounted files appear executable inside Linux containers regardless of their Git mode. The wrappers therefore ignore only Ruff `EXE002` on Windows hosts; other executable-file rules and all substantive lint checks remain active.

Tests use a database named from `ODOO_TEST_DB_PREFIX`, a UTC timestamp, and the wrapper process identifier. A passing run removes that exact database. A failing run preserves it for `shell` or `db-shell` investigation and prints its name. Use `-CleanupOnFailure` in PowerShell or pass `--cleanup-on-failure` as the fourth Bash token to remove that exact test database after a failure. Otherwise, delete a preserved database explicitly from `db-shell` when investigation is complete.

## Docs build pipeline

`docs-build:doc` renders one `docs/teach/*.md` entry file into a self-contained static HTML page via `scripts/docs_build/`. Per [#38](https://github.com/dahagag/odoo/issues/38), it also crawls that file's local `.md` links (an ADR, a `CONTEXT.md`, a research doc, another teach doc) and renders each one it finds, transitively, through the same shared template — a link between two rendered documents is rewritten to point at the generated `.html` file; an external URL passes through unchanged; a local `.md` link that doesn't resolve to a real file fails the build, naming both the linking document and the broken reference. A document nothing in the closure links to is never rendered, even if it exists in the repo. The Markdown-to-HTML transform (`scripts/docs_build/markdown_transform.py`) stays a pure function — no filesystem or network access, taking an optional `link_resolver` callback to rewrite local links — and is unit-tested directly with `python -m unittest discover -s scripts/docs_build/tests`, independent of the Docker/PostgreSQL stack; the filesystem crawl that discovers the closure and calls the resolver lives in `scripts/docs_build/cli.py`, the thin wrapper the `dev.ps1`/`dev.sh` subcommand invokes inside the Odoo container (via `python3 -m scripts.docs_build.cli`, no database required). The shared template's color tokens and component patterns match `docs/teach/DESIGN-TOKENS.md`; fonts use system-font fallback stacks rather than the Google Fonts `<link>` shown there, since the acceptance criteria for [#35](https://github.com/dahagag/odoo/issues/35) require zero network requests at view time. Output is written to `custom_addons/crm_methodology/static/docs/`, the publishing path fixed by docs/adr/0007.

## Browser tests

The development image installs Google Chrome (`google-chrome-stable`) specifically for `odoo.tests.HttpCase.start_tour` — Ubuntu's own `chromium`/`chromium-browser` packages are snap-only stubs with no real binary in a container, so Odoo's own browser detection (which looks for `google-chrome`/`chromium`/etc. on `PATH`) would otherwise skip every tour test with "Chrome executable not found". `requirements.txt` also pins `websocket-client`, which `HttpCase` needs to drive Chrome over the DevTools protocol; without it, tour tests are silently skipped ("websocket-client module is not installed") rather than run. `custom_addons/dev_e2e_smoke_test` holds a minimal tour with no dependency on any other addon; run `./scripts/dev.ps1 test dev_e2e_smoke_test` to confirm this seam works in a given environment.

Tag tour/`HttpCase` tests `@tagged('post_install', '-at_install')` (they need a running HTTP server, not available at `at_install` time) — see `custom_addons/dev_e2e_smoke_test/tests/test_browser_tour_smoke.py` and its matching tour in `custom_addons/dev_e2e_smoke_test/static/tests/tours/`. No extra flags are needed to run them: `scripts/dev.ps1 test <module>` already includes every tagged test in that module.

A tour step whose `run` triggers a full page navigation (e.g. a wizard button returning `{'type': 'ir.actions.client', 'tag': 'reload'}`) must set `expectUnloadPage: true` on that step, or the tour engine flags the run as non-deterministic and fails it.

## Troubleshooting

### Docker engine is not running

`doctor` reports this before attempting a build. Start Docker Desktop and ensure it is using Linux/WSL2 containers, or start Docker Engine on Linux. The wrapper does not start or reconfigure the daemon.

### Compose is unavailable

Install either the Docker Compose plugin or standalone `docker-compose`. The wrapper probes the plugin first and falls back automatically.

### A host port is occupied

Change `ODOO_HTTP_PORT` or `ODOO_GEVENT_PORT` in `.env`, then run `down` and `up`. PostgreSQL is intentionally reachable only through `db-shell`.

### PostgreSQL does not become healthy

Inspect the database container with the detected Compose command, for example `docker-compose logs db`. Validate `.env` values. PostgreSQL initialization variables affect only an empty data volume; use the confirmed `reset` command only when discarding local data is acceptable.

### Image or dependency build fails

Confirm registry/network access and that the pinned `ODOO_IMAGE` tag is available. The build uses the official Odoo image baseline, this checkout's `requirements.txt`, Ruff 0.16.1, Node/npm, and `rtlcss`. Update a pinned image intentionally and review the resulting Odoo/Python/reporting versions.

### Addon is not found

Confirm `custom_addons/<module>/__manifest__.py` exists and the module name matches its directory. Restart after adding a new addon, then use `install` or `update`.

### Code or views appear stale

Run `update <module>` for model, data, security, or view changes. XML views are read from source in the default development mode, while Python changes require an Odoo container restart. An installed module still needs an upgrade when database metadata changes.

### PDF reports are incomplete

Run `build` and inspect the build checks for `wkhtmltopdf`. Odoo requires a compatible 0.12.6 build for complete header and footer behavior.

### RTL styles are missing

Run `build` and inspect its `rtlcss --version` check. The tool is installed inside the development image rather than on the host.

### Browser tours fail

Read the test log and the screenshot/screencast paths printed by `HttpCase`. Preserve the failed test database, reproduce with a narrow test tag, and use Odoo's watch/debug tour options only in the disposable environment.
