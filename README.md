# Odoo

[![Build Status](https://runbot.odoo.com/runbot/badge/flat/1/master.svg)](https://runbot.odoo.com/runbot)
[![Tech Doc](https://img.shields.io/badge/master-docs-875A7B.svg?style=flat&colorA=8F8F8F)](https://www.odoo.com/documentation/master)
[![Help](https://img.shields.io/badge/master-help-875A7B.svg?style=flat&colorA=8F8F8F)](https://www.odoo.com/forum/help-1)
[![Nightly Builds](https://img.shields.io/badge/master-nightly-875A7B.svg?style=flat&colorA=8F8F8F)](https://nightly.odoo.com/)

Odoo is a suite of web based open source business apps.

The main Odoo Apps include an [Open Source CRM](https://www.odoo.com/page/crm),
[Website Builder](https://www.odoo.com/app/website),
[eCommerce](https://www.odoo.com/app/ecommerce),
[Warehouse Management](https://www.odoo.com/app/inventory),
[Project Management](https://www.odoo.com/app/project),
[Billing &amp; Accounting](https://www.odoo.com/app/accounting),
[Point of Sale](https://www.odoo.com/app/point-of-sale-shop),
[Human Resources](https://www.odoo.com/app/employees),
[Marketing](https://www.odoo.com/app/social-marketing),
[Manufacturing](https://www.odoo.com/app/manufacturing),
[...](https://www.odoo.com/)

Odoo Apps can be used as stand-alone applications, but they also integrate seamlessly so you get
a full-featured [Open Source ERP](https://www.odoo.com) when you install several Apps.

## Getting started with Odoo

For a standard installation please follow the [Setup instructions](https://www.odoo.com/documentation/master/administration/install/install.html)
from the documentation.

To learn the software, we recommend the [Odoo eLearning](https://www.odoo.com/slides),
or [Scale-up, the business game](https://www.odoo.com/page/scale-up-business-game).
Developers can start with [the developer tutorials](https://www.odoo.com/documentation/master/developer/howtos.html).

## Local development

This checkout includes a Docker-based development environment. On Windows, run:

```powershell
Copy-Item .env.example .env
./scripts/dev.ps1 doctor
./scripts/dev.ps1 build
./scripts/dev.ps1 init
./scripts/dev.ps1 up
```

Open `http://localhost:8069`. Run `./scripts/dev.ps1 --help` for the complete command list and arguments. On Linux or macOS, use `bash scripts/dev.sh --help`; see [docs/agents/local-development.md](docs/agents/local-development.md) for the full workflow.

Use `./scripts/dev.ps1 <command>` on PowerShell or `bash scripts/dev.sh <command>` on Linux and macOS. Both wrappers support `--help` and `-h`.

| Command                          | Description                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                         | Verifies required files, Docker, Compose, ports, and the Compose configuration.                                                                                |
| `build`                          | Builds the Odoo development image and verifies development tools.                                                                                              |
| `init`                           | Starts PostgreSQL and creates the base/web development database when needed.                                                                                   |
| `up`                             | Starts PostgreSQL and Odoo in the background.                                                                                                                  |
| `down`                           | Stops the stack without deleting its database or filestore.                                                                                                    |
| `logs`                           | Follows Odoo server logs.                                                                                                                                      |
| `shell`                          | Opens an Odoo shell in the development database.                                                                                                               |
| `db-shell`                       | Opens a `psql` session in the development database.                                                                                                            |
| `scaffold <module>`              | Creates a new owned module under `custom_addons/`.                                                                                                             |
| `install <module>`               | Installs an owned module, then restores the development server.                                                                                                |
| `update <module>`                | Upgrades an owned module and restarts the development server.                                                                                                  |
| `test <module> [tags]`           | Runs focused module tests in an ephemeral database. Add `-CleanupOnFailure` in PowerShell or `--cleanup-on-failure` in Bash to delete a failing test database. |
| `lint [path]`                    | Runs Ruff, defaulting to `custom_addons/`; paths must remain inside the repository.                                                                            |
| `docs-build:doc [file]`          | Renders one `docs/teach/*.md` entry and its linked Markdown closure, or all teach docs when no file is supplied.                                               |
| `docs-build:video <project-dir>` | Re-renders an authored HyperFrames project into its sibling documentation video.                                                                               |
| `docs-build`                     | Rebuilds all teach docs and every authored documentation video.                                                                                                |
| `reset`                          | Deletes local development data after an exact project-name confirmation.                                                                                       |

See [docs/agents/local-development.md](docs/agents/local-development.md) for examples, prerequisites, and command behavior in detail.

## Security

If you believe you have found a security issue, check our [Responsible Disclosure page](https://www.odoo.com/security-report)
for details and get in touch with us via email.
