param([switch]$SkipInstall, [switch]$PrepareOffline)
$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $root
$env:UV_CACHE_DIR = Join-Path $root '.cache\uv'
$env:PYTHONUTF8 = '1'

function Check-Exit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)." }
}

if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        & uv venv --python 3.12 .venv
        Check-Exit 'Python environment creation'
    } elseif (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.12 -m venv .venv
        Check-Exit 'Python 3.12 environment creation'
    } else {
        & python -m venv .venv
        Check-Exit 'Python environment creation (requires Python 3.12+)'
    }
}
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not $SkipInstall) {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        & uv pip install --python $python -r requirements.lock
    } else {
        & $python -m pip install -r requirements.lock
    }
    Check-Exit 'Backend dependency installation'
    Push-Location -LiteralPath (Join-Path $root 'frontend')
    try {
        & npm.cmd ci
        Check-Exit 'Frontend dependency installation'
        & npm.cmd run build
        Check-Exit 'Frontend build'
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath 'frontend\dist\index.html')) {
    throw 'Frontend build not found. Run start.ps1 without -SkipInstall.'
}
if ($PrepareOffline) {
    & $python scripts/prepare_offline.py --mirror
    Check-Exit 'Offline vision model preparation'
}
& $python scripts/create_demo.py
Check-Exit 'Sample creation'
Write-Host ''
Write-Host 'NeatDrop: http://127.0.0.1:8765' -ForegroundColor Green
Write-Host 'Copy-only mode. Originals are never removed. Press Ctrl+C to stop.'
Write-Host 'Do not expose this local single-user service to a network.'
$env:PYTHONPATH = Join-Path $root 'backend'
& $python -m uvicorn neatdrop.app:app --host 127.0.0.1 --port 8765 --no-access-log --no-proxy-headers --limit-concurrency 32 --timeout-keep-alive 5
Check-Exit 'Local service'
