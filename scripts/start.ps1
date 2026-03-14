# Open Cowork - Startup Script
# This script starts the application.
# Environment variables should be set in .env file or system environment.

Write-Host "Starting Open Cowork..." -ForegroundColor Cyan
Write-Host ""

# Check if .env file exists
if (Test-Path ".env") {
    Write-Host "Found .env file - environment variables will be loaded automatically" -ForegroundColor Green
} else {
    Write-Host "No .env file found - copy .env.example to .env and configure your settings" -ForegroundColor Yellow
    Write-Host "  cp .env.example .env" -ForegroundColor Gray
}

Write-Host ""

# Start the dev server
npm run dev
