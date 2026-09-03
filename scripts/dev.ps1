param(
    [Parameter(Position = 0)]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$Argument,

    [Parameter(Position = 2)]
    [string]$Extra,

    [switch]$CleanupOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ComposeKind = $null
$script:LastComposeExitCode = 0
Set-Location -LiteralPath $script:RepoRoot

function Show-Usage {
    param([int]$ExitCode = 2)
    Write-Host 'Usage: ./scripts/dev.ps1 {doctor|build|init|up|down|logs|shell|db-shell|scaffold|install|update|test|lint|docs-build|docs-build:doc|docs-build:video|reset} [argument] [extra] [-CleanupOnFailure]'
    exit $ExitCode
}

function Resolve-Compose {
    if ($script:ComposeKind) { return }
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is not installed or is not available on PATH.'
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -eq 0) {
        $script:ComposeKind = 'plugin'
        return
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $script:ComposeKind = 'standalone'
        return
    }
    throw 'Docker Compose is unavailable. Install the Docker Compose plugin or standalone docker-compose.'
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    Resolve-Compose
    if ($script:ComposeKind -eq 'plugin') {
        & docker compose @Arguments
    } else {
        & docker-compose @Arguments
    }
    $script:LastComposeExitCode = $LASTEXITCODE
    if ($script:LastComposeExitCode -ne 0 -and -not $AllowFailure) {
        throw "Docker Compose failed with exit code $script:LastComposeExitCode."
    }
}

function Get-ComposeOutput {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    Resolve-Compose
    if ($script:ComposeKind -eq 'plugin') {
        $output = & docker compose @Arguments
    } else {
        $output = & docker-compose @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed with exit code $LASTEXITCODE."
    }
    return $output
}

function Get-DevSetting {
    param([string]$Name, [string]$Default)
    $envPath = Join-Path $script:RepoRoot '.env'
    if (Test-Path -LiteralPath $envPath) {
        foreach ($line in Get-Content -LiteralPath $envPath) {
            if ($line -match '^\s*([^#][A-Za-z0-9_]*)\s*=\s*(.*)\s*$' -and $Matches[1] -eq $Name) {
                return $Matches[2].Trim().Trim('"').Trim("'")
            }
        }
    }
    return $Default
}

function Require-EnvironmentFile {
    if (-not (Test-Path -LiteralPath (Join-Path $script:RepoRoot '.env'))) {
        throw 'Missing .env. Copy .env.example to .env, review the development-only credentials, and retry.'
    }
}

function Assert-Identifier {
    param([string]$Value, [string]$Label)
    if ($Value -notmatch '^[a-z][a-z0-9_]*$') {
        throw "$Label '$Value' must start with a lowercase letter and contain only lowercase letters, digits, and underscores."
    }
}

function Assert-Module {
    param([string]$Module, [switch]$MustExist)
    if (-not $Module) { throw 'A module name is required.' }
    Assert-Identifier $Module 'Module name'
    if ($MustExist) {
        $manifest = Join-Path $script:RepoRoot "custom_addons\$Module\__manifest__.py"
        if (-not (Test-Path -LiteralPath $manifest)) {
            throw "Owned module '$Module' was not found under custom_addons/."
        }
    }
}

function Resolve-HostPython {
    # docs-build:video shells out to the HyperFrames CLI (npx hyperframes render),
    # which needs the local ffmpeg/ffprobe/Chrome-Headless-Shell toolchain
    # installed on the host (see issue #36) - none of that is in the Odoo dev
    # image, so unlike every other subcommand here, this one runs on the host,
    # not via Invoke-Compose.
    # Windows ships App Execution Alias stubs for python/python3 that resolve via
    # Get-Command but only print a "Python was not found" hint and exit 49, so
    # probe that each candidate actually runs before trusting it - otherwise
    # docs-build:video silently renders nothing on a machine whose real
    # interpreter is installed under a different name.
    foreach ($candidate in @('python3', 'python', 'py')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        & $command.Source '-c' '' 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return $command.Source }
    }
    throw 'No working Python interpreter (python3/python/py) found on PATH.'
}

function Assert-RelativePath {
    param([string]$Path, [string]$Label)
    if (-not $Path) { throw "$Label requires a path argument." }
    $normalized = $Path -replace '\\', '/'
    if ([IO.Path]::IsPathRooted($Path) -or $normalized -split '/' -contains '..') {
        throw "$Label path must be a relative path inside the repository."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:RepoRoot $normalized))) {
        throw "$Label path '$Path' does not exist."
    }
    return $normalized
}

function Invoke-DocsBuildDoc {
    param([string]$Argument)
    $cliArguments = @('run', '--rm', '--no-deps', 'odoo', 'python3', '-m', 'scripts.docs_build.cli')
    if ($Argument) {
        $cliArguments += Assert-RelativePath -Path $Argument -Label 'docs-build:doc'
    }
    Invoke-Compose -Arguments $cliArguments
}

function Invoke-DocsBuildVideo {
    param([string]$ProjectPath)
    $relativePath = Assert-RelativePath -Path $ProjectPath -Label 'docs-build:video'
    $python = Resolve-HostPython
    & $python -m scripts.docs_build.video_cli $relativePath
    if ($LASTEXITCODE -ne 0) { throw "docs-build:video failed with exit code $LASTEXITCODE." }
}

function Get-DocsBuildVideoProjects {
    # Authored HyperFrames projects live at docs/teach/videos/<stem>/ (see
    # scripts/docs_build/video_cli.py and docs/adr/0008) - one per teach doc that
    # has a walkthrough video authored for it. Bare `docs-build` re-renders every
    # one it finds; a teach doc with no authored project simply has no video.
    $videosDir = Join-Path $script:RepoRoot 'docs\teach\videos'
    if (-not (Test-Path -LiteralPath $videosDir)) { return @() }
    Get-ChildItem -LiteralPath $videosDir -Directory |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'hyperframes.json') } |
        ForEach-Object { [System.IO.Path]::GetRelativePath($script:RepoRoot, $_.FullName) -replace '\\', '/' } |
        Sort-Object
}

function Start-Database {
    Invoke-Compose -Arguments @('up', '-d', 'db')
    $user = Get-DevSetting 'POSTGRES_USER' 'odoo'
    # On a fresh volume, Postgres' entrypoint briefly runs a temporary server to apply init
    # scripts, stops it, then starts the real one; pg_isready can report ready during that
    # temporary server's short life. Require two ready checks a second apart so a restart in
    # between is caught (the counter resets) instead of returning into that shutdown window.
    $consecutive = 0
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        Invoke-Compose -Arguments @('exec', '-T', 'db', 'pg_isready', '-U', $user, '-d', 'postgres') -AllowFailure
        if ($script:LastComposeExitCode -eq 0) {
            $consecutive++
            if ($consecutive -ge 2) { return }
        } else {
            $consecutive = 0
        }
        Start-Sleep -Seconds 1
    }
    throw 'PostgreSQL did not become healthy within 60 seconds. Run the logs command for details.'
}

function Invoke-OdooRun {
    param([string[]]$Arguments, [switch]$AllowFailure)
    $composeArgs = @('run', '--rm', '--no-deps', 'odoo', 'odoo-source') + $Arguments
    Invoke-Compose -Arguments $composeArgs -AllowFailure:$AllowFailure
}

function Initialize-Database {
    Start-Database
    $database = Get-DevSetting 'ODOO_DB' 'agentic_erp_dev'
    $user = Get-DevSetting 'POSTGRES_USER' 'odoo'
    Assert-Identifier $database 'Database name'

    $exists = Get-ComposeOutput -Arguments @('exec', '-T', 'db', 'psql', '-U', $user, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = '$database'")
    if (($exists | Out-String).Trim() -ne '1') {
        Invoke-Compose -Arguments @('exec', '-T', 'db', 'createdb', '-U', $user, $database)
    }

    $initialized = Get-ComposeOutput -Arguments @('exec', '-T', 'db', 'psql', '-U', $user, '-d', $database, '-tAc', "SELECT CASE WHEN to_regclass('public.ir_module_module') IS NOT NULL THEN 1 ELSE 0 END")
    if (($initialized | Out-String).Trim() -eq '1') {
        Write-Host "Database '$database' is already initialized."
        return
    }
    Invoke-OdooRun -Arguments @("--database=$database", '--init=base,web', '--without-demo', '--stop-after-init')
    Write-Host "Initialized development database '$database'."
}

function Invoke-ModuleLifecycle {
    param([string]$Module, [ValidateSet('install', 'update')][string]$Mode)
    Assert-Module $Module -MustExist
    Initialize-Database
    $database = Get-DevSetting 'ODOO_DB' 'agentic_erp_dev'
    Assert-Identifier $database 'Database name'
    Invoke-Compose -Arguments @('stop', 'odoo') -AllowFailure
    try {
        $switch = if ($Mode -eq 'install') { "--init=$Module" } else { "--update=$Module" }
        Invoke-OdooRun -Arguments @("--database=$database", $switch, '--stop-after-init')
    } finally {
        Invoke-Compose -Arguments @('up', '-d', 'odoo') -AllowFailure
    }
}

function Invoke-ModuleTest {
    param([string]$Module, [string]$Tags, [bool]$Cleanup)
    Assert-Module $Module -MustExist
    Start-Database
    $user = Get-DevSetting 'POSTGRES_USER' 'odoo'
    $prefix = Get-DevSetting 'ODOO_TEST_DB_PREFIX' 'agentic_erp_test'
    Assert-Identifier $prefix 'Test database prefix'
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
    $testDatabase = "${prefix}_${stamp}_$PID"
    Assert-Identifier $testDatabase 'Test database name'
    if (-not $Tags) { $Tags = "/$Module" }

    Invoke-Compose -Arguments @('exec', '-T', 'db', 'createdb', '-U', $user, $testDatabase)
    Invoke-OdooRun -Arguments @("--database=$testDatabase", "--init=$Module", '--without-demo', '--test-enable', "--test-tags=$Tags", '--stop-after-init', '--log-level=test') -AllowFailure
    $testExitCode = $script:LastComposeExitCode
    if ($testExitCode -eq 0) {
        Invoke-Compose -Arguments @('exec', '-T', 'db', 'dropdb', '-U', $user, $testDatabase)
        Write-Host "Tests passed; removed ephemeral database '$testDatabase'."
        return
    }
    if ($Cleanup) {
        Invoke-Compose -Arguments @('exec', '-T', 'db', 'dropdb', '-U', $user, $testDatabase)
        Write-Warning "Tests failed with exit code $testExitCode. Removed database '$testDatabase' as requested."
    } else {
        Write-Warning "Tests failed with exit code $testExitCode. Preserved database '$testDatabase' for investigation."
    }
    exit $testExitCode
}

function Invoke-Doctor {
    Resolve-Compose
    $required = @('compose.yaml', 'docker\odoo-dev.Dockerfile', 'docker\odoo.conf', '.env.example', 'custom_addons\README.md')
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $script:RepoRoot $path))) {
            throw "Missing required development file: $path"
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $script:RepoRoot '.env'))) {
        throw 'Missing .env. Copy .env.example to .env before starting the stack.'
    }
    $serverVersion = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $serverVersion) {
        throw 'The Docker engine is not running. Start Docker Desktop with the Linux/WSL2 engine and retry.'
    }
    $httpPort = [int](Get-DevSetting 'ODOO_HTTP_PORT' '8069')
    $geventPort = [int](Get-DevSetting 'ODOO_GEVENT_PORT' '8072')
    foreach ($port in @($httpPort, $geventPort)) {
        if ($port -lt 1 -or $port -gt 65535) { throw "Invalid host port: $port" }
    }
    $runningServices = @(Get-ComposeOutput -Arguments @('ps', '--status', 'running', '--services'))
    if ($runningServices -notcontains 'odoo') {
        foreach ($port in @($httpPort, $geventPort)) {
            $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
            try {
                $listener.Start()
            } catch {
                throw "Localhost port $port is already occupied. Change the corresponding value in .env."
            } finally {
                $listener.Stop()
            }
        }
    }
    Invoke-Compose -Arguments @('config', '--quiet')
    Write-Host "Doctor passed: Docker $serverVersion, Compose $script:ComposeKind, HTTP $httpPort, gevent $geventPort."
}

if ($Command -in @('--help', '-h')) { Show-Usage -ExitCode 0 }
if (-not $Command) { Show-Usage }

Require-EnvironmentFile

switch ($Command) {
    'doctor' { Invoke-Doctor }
    'build' { Invoke-Compose -Arguments @('build', 'odoo') }
    'init' { Initialize-Database }
    'up' { Start-Database; Invoke-Compose -Arguments @('up', '-d', 'odoo') }
    'down' { Invoke-Compose -Arguments @('down') }
    'logs' { Invoke-Compose -Arguments @('logs', '--follow', 'odoo') }
    'shell' {
        Start-Database
        $database = Get-DevSetting 'ODOO_DB' 'agentic_erp_dev'
        Invoke-Compose -Arguments @('run', '--rm', '--no-deps', 'odoo', 'odoo-source', 'shell', "--database=$database")
    }
    'db-shell' {
        Start-Database
        $user = Get-DevSetting 'POSTGRES_USER' 'odoo'
        $database = Get-DevSetting 'ODOO_DB' 'agentic_erp_dev'
        Invoke-Compose -Arguments @('exec', 'db', 'psql', '-U', $user, '-d', $database)
    }
    'scaffold' {
        Assert-Module $Argument
        foreach ($root in @('odoo\addons', 'addons', 'custom_addons')) {
            if (Test-Path -LiteralPath (Join-Path $script:RepoRoot "$root\$Argument")) {
                throw "Module '$Argument' already exists under $root."
            }
        }
        Invoke-Compose -Arguments @('run', '--rm', '--no-deps', 'odoo', 'python3', '/workspace/odoo-bin', 'scaffold', $Argument, '/workspace/custom_addons')
    }
    'install' { Invoke-ModuleLifecycle $Argument 'install' }
    'update' { Invoke-ModuleLifecycle $Argument 'update' }
    'test' { Invoke-ModuleTest $Argument $Extra $CleanupOnFailure.IsPresent }
    'lint' {
        $path = if ($Argument) { $Argument } else { 'custom_addons' }
        $path = Assert-RelativePath -Path $path -Label 'Lint'
        $ruffArguments = @('run', '--rm', '--no-deps', 'odoo', 'ruff', 'check')
        if ($IsWindows) { $ruffArguments += @('--ignore', 'EXE002') }
        $ruffArguments += "/workspace/$path"
        Invoke-Compose -Arguments $ruffArguments
    }
    'docs-build' {
        Invoke-DocsBuildDoc -Argument $null
        foreach ($project in Get-DocsBuildVideoProjects) {
            Invoke-DocsBuildVideo -ProjectPath $project
        }
    }
    'docs-build:doc' { Invoke-DocsBuildDoc -Argument $Argument }
    'docs-build:video' { Invoke-DocsBuildVideo -ProjectPath $Argument }
    'reset' {
        $project = Get-DevSetting 'COMPOSE_PROJECT_NAME' 'agentic-erp-dev'
        if ($project -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw "Unsafe Compose project name '$project'." }
        Write-Warning 'This permanently removes the local development database and filestore.'
        Write-Host "Project: $project"
        Write-Host "Volumes: ${project}_postgres_data, ${project}_odoo_data"
        $confirmation = Read-Host "Type '$project' to confirm"
        if ($confirmation -ne $project) { throw 'Reset cancelled.' }
        Invoke-Compose -Arguments @('down', '--volumes', '--remove-orphans')
    }
    default { Show-Usage }
}
