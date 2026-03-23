# messy-desktop.ps1 — Create a messy Desktop with random files for CUA benchmark
# Usage: powershell -ExecutionPolicy Bypass -File messy-desktop.ps1 [create|clean|verify]
#
# create  — generate messy files on Desktop
# clean   — remove all generated files and folders
# verify  — check if files were properly organized into folders

param(
    [Parameter(Position=0)]
    [ValidateSet("create", "clean", "verify")]
    [string]$Action = "create"
)

$Desktop = [Environment]::GetFolderPath("Desktop")
$Prefix = "demo_"

# File definitions: 120 realistic files — a desktop that hasn't been cleaned in months
$Files = @{
    # ── Documents / Text (22 files) ──
    "${Prefix}Meeting Notes 03-22.txt"         = "Team Sync - March 22`nKey: Launch moved to May 15th"
    "${Prefix}Meeting Notes 03-15.txt"         = "Sprint Retro`nAction: reduce PR review time"
    "${Prefix}Meeting Notes 02-28.txt"         = "All-hands`nSeries B closed. New office in June"
    "${Prefix}Travel Expense Report.txt"       = "SF Trip`nFlights: 842`nHotel: 1290`nTotal: 2711"
    "${Prefix}Ideas for Q3 Features.txt"       = "1. Dark mode 2. PDF export 3. SSO"
    "${Prefix}1-on-1 Notes with Manager.txt"   = "Topics: perf review, hiring, conference"
    "${Prefix}Standup Notes Monday.txt"        = "Done: auth bug`nBlocked: API key`nTodo: tests"
    "${Prefix}Phone Screen Questions.txt"      = "1. Challenging project 2. System design"
    "${Prefix}Draft Blog Post.txt"             = "Title: Why We Migrated to Kubernetes"
    "${Prefix}Intern Project Brief.txt"        = "Project: build internal dashboard`nStack: React + FastAPI`nTimeline: 8 weeks"
    "${Prefix}Interview Questions.docx"        = "DOCX_PLACEHOLDER"
    "${Prefix}Onboarding Checklist.docx"       = "DOCX_PLACEHOLDER"
    "${Prefix}Project Proposal Draft.docx"     = "DOCX_PLACEHOLDER"
    "${Prefix}Performance Review 2025.docx"    = "DOCX_PLACEHOLDER"
    "${Prefix}Cover Letter Final.docx"         = "DOCX_PLACEHOLDER"
    "${Prefix}Team Charter.docx"               = "DOCX_PLACEHOLDER"
    "${Prefix}Quarterly Report Q1 2026.pdf"    = "PDF_PLACEHOLDER"
    "${Prefix}NDA Template.pdf"                = "PDF_PLACEHOLDER"
    "${Prefix}Team Org Chart.pdf"              = "PDF_PLACEHOLDER"
    "${Prefix}Brand Guidelines v3.pdf"         = "PDF_PLACEHOLDER"
    "${Prefix}Insurance Claim Form.pdf"        = "PDF_PLACEHOLDER"
    "${Prefix}Tax Return 2025.pdf"             = "PDF_PLACEHOLDER"

    # ── Presentations (4 files) ──
    "${Prefix}Product Roadmap.pptx"            = "PPTX_PLACEHOLDER"
    "${Prefix}Q2 Strategy Deck.pptx"           = "PPTX_PLACEHOLDER"
    "${Prefix}Tech Talk - GraphQL.pptx"        = "PPTX_PLACEHOLDER"
    "${Prefix}Client Demo March.pptx"          = "PPTX_PLACEHOLDER"

    # ── Code (18 files) ──
    "${Prefix}data_pipeline.py"                = "import pandas as pd`ndef process(df): return df.dropna()"
    "${Prefix}test_auth.py"                    = "import pytest`ndef test_login(): assert True"
    "${Prefix}scraper.py"                      = "import requests`ndef scrape(url): return requests.get(url).text"
    "${Prefix}train_model.py"                  = "import torch`nmodel = torch.nn.Linear(10,1)`nprint('params:', sum(p.numel() for p in model.parameters()))"
    "${Prefix}api_endpoints.js"                = "const router = require('express').Router();`nrouter.get('/users', (r,s) => s.json([]));"
    "${Prefix}utils.js"                        = "const fmt = d => d.toISOString().split('T')[0];`nmodule.exports={fmt};"
    "${Prefix}dashboard.tsx"                   = "import React from 'react';`nexport const Dashboard = () => <div>Hello</div>;"
    "${Prefix}index.ts"                        = "import express from 'express';`napp.listen(3000);"
    "${Prefix}main.go"                         = "package main`nimport `"fmt`"`nfunc main() { fmt.Println(`"Hello`") }"
    "${Prefix}server.rs"                       = "fn main() { println!(`"server starting`"); }"
    "${Prefix}query.sql"                       = "SELECT name, COUNT(*) FROM users GROUP BY name;"
    "${Prefix}styles.css"                      = "body { font-family: sans-serif; margin: 0; }`n.btn { padding: 8px; }"
    "${Prefix}landing_page.html"               = "<!DOCTYPE html><html><body><h1>Welcome</h1></body></html>"
    "${Prefix}setup.sh"                        = "#!/bin/bash`npip install -r requirements.txt"
    "${Prefix}deploy.sh"                       = "#!/bin/bash`ndocker build -t myapp . && docker push myapp"
    "${Prefix}cleanup.bat"                     = "@echo off`ndel /q *.tmp`necho Done."
    "${Prefix}Makefile"                        = "all: build`nbuild:`n`tgo build -o bin/app"
    "${Prefix}snippet.cpp"                     = "#include <iostream>`nint main() { std::cout << `"Hello`"; return 0; }"

    # ── Config (14 files) ──
    "${Prefix}docker-compose.yml"              = "version: '3.8'`nservices:`n  web: {build: ., ports: ['3000:3000']}"
    "${Prefix}docker-compose.prod.yml"         = "version: '3.8'`nservices:`n  web: {image: myapp:latest, restart: always}"
    "${Prefix}app_config.json"                 = "{`"app`":`"dashboard`",`"port`":8080}"
    "${Prefix}package.json"                    = "{`"name`":`"my-app`",`"version`":`"1.0.0`"}"
    "${Prefix}tsconfig.json"                   = "{`"compilerOptions`":{`"target`":`"es2020`",`"strict`":true}}"
    "${Prefix}eslint.config.js"                = "module.exports = { rules: { semi: 'error' } };"
    "${Prefix}.env.example"                    = "DATABASE_URL=postgres://localhost/myapp`nSECRET_KEY=change-me"
    "${Prefix}.gitignore"                      = "node_modules/`ndist/`n.env`n*.log"
    "${Prefix}.prettierrc"                     = "{`"semi`":true,`"singleQuote`":true}"
    "${Prefix}nginx.conf"                      = "server { listen 80; proxy_pass http://localhost:3000; }"
    "${Prefix}Dockerfile"                      = "FROM python:3.12`nCOPY . .`nCMD [`"gunicorn`",`"app:app`"]"
    "${Prefix}requirements.txt"                = "flask==3.0.2`npandas==2.2.1`nnumpy==1.26.4"
    "${Prefix}Cargo.toml"                      = "[package]`nname = `"server`"`nversion = `"0.1.0`""
    "${Prefix}go.mod"                          = "module myapp`ngo 1.22`nrequire github.com/gin-gonic/gin v1.9.1"

    # ── Data & Spreadsheets (16 files) ──
    "${Prefix}Sales Report March.csv"          = "Region,Product,Revenue`nNA,Pro,62500`nEU,Pro,44500"
    "${Prefix}User Analytics.csv"              = "Date,DAU,MAU`n2026-03-01,12450,89200"
    "${Prefix}Customer Feedback.csv"           = "ID,Customer,Rating`n1,Acme,4`n2,TechStart,5"
    "${Prefix}survey_results_raw.csv"          = "ID,Q1,Q2,Q3`n1,5,4,3`n2,4,5,4"
    "${Prefix}employee_directory.csv"          = "Name,Dept`nAlice,Eng`nBob,Mktg"
    "${Prefix}ab_test_results.csv"             = "Variant,Rate`nControl,3.0`nTest_A,3.7"
    "${Prefix}website_traffic.csv"             = "Source,Visits`nOrganic,15000`nPaid,8000"
    "${Prefix}churn_analysis.csv"              = "Month,Churn`nJan,2.1`nFeb,1.8`nMar,2.3"
    "${Prefix}inventory_q1.xlsx"               = "XLSX_PLACEHOLDER"
    "${Prefix}budget_2026.xlsx"                = "XLSX_PLACEHOLDER"
    "${Prefix}headcount_plan.xlsx"             = "XLSX_PLACEHOLDER"
    "${Prefix}marketing_spend.xlsx"            = "XLSX_PLACEHOLDER"
    "${Prefix}revenue_forecast.xlsx"           = "XLSX_PLACEHOLDER"
    "${Prefix}backup_db_20260318.sql"          = "CREATE TABLE users (id SERIAL, email VARCHAR(255));"
    "${Prefix}seed_data.sql"                   = "INSERT INTO products VALUES ('Widget',29.99);"
    "${Prefix}migration_v2.sql"                = "ALTER TABLE users ADD COLUMN role VARCHAR(50);"

    # ── Images & Design (16 files) ──
    "${Prefix}dashboard_mockup_v3.png"         = "PNG_PLACEHOLDER"
    "${Prefix}bug_screenshot_login.png"        = "PNG_PLACEHOLDER"
    "${Prefix}wireframe_mobile_v2.png"         = "PNG_PLACEHOLDER"
    "${Prefix}error_screenshot_0321.png"       = "PNG_PLACEHOLDER"
    "${Prefix}screenshot_settings_page.png"    = "PNG_PLACEHOLDER"
    "${Prefix}screenshot_404_error.png"        = "PNG_PLACEHOLDER"
    "${Prefix}logo_redesign_final.png"         = "PNG_PLACEHOLDER"
    "${Prefix}favicon.ico"                     = "ICO_PLACEHOLDER"
    "${Prefix}team_photo_offsite.jpg"          = "JFIF_PLACEHOLDER"
    "${Prefix}banner_ad_draft.jpg"             = "JFIF_PLACEHOLDER"
    "${Prefix}headshot_linkedin.jpg"           = "JFIF_PLACEHOLDER"
    "${Prefix}whiteboard_photo.jpg"            = "JFIF_PLACEHOLDER"
    "${Prefix}product_photo_v2.jpg"            = "JFIF_PLACEHOLDER"
    "${Prefix}office_panorama.jpg"             = "JFIF_PLACEHOLDER"
    "${Prefix}icon_set_export.svg"             = "<svg width='24' height='24'><circle cx='12' cy='12' r='10'/></svg>"
    "${Prefix}architecture_diagram.svg"        = "<svg width='200' height='100'><text x='10' y='50'>System</text></svg>"

    # ── Logs (8 files) ──
    "${Prefix}server_error_2026-03-20.log"     = "[ERROR] Connection pool exhausted"
    "${Prefix}server_error_2026-03-18.log"     = "[ERROR] Disk space low (92%%)"
    "${Prefix}deploy_log_v2.1.log"             = "Tests: 247 passed. Deployment complete"
    "${Prefix}deploy_log_v2.0.log"             = "Tests: 231 passed. Deployment complete"
    "${Prefix}access_log_march.log"            = "10.0.0.1 GET /api/users 200"
    "${Prefix}cron_job_output.log"             = "Nightly backup: 2.3GB. Done"
    "${Prefix}npm_install_debug.log"           = "added 847 packages in 32s"
    "${Prefix}pytest_output.log"               = "130 passed, 8 failed, 4 skipped"

    # ── Archives (6 files) ──
    "${Prefix}project_backup_march.zip"        = "ZIP_PLACEHOLDER"
    "${Prefix}design_assets_v2.zip"            = "ZIP_PLACEHOLDER"
    "${Prefix}fonts_pack.zip"                  = "ZIP_PLACEHOLDER"
    "${Prefix}old_laptop_photos.zip"           = "ZIP_PLACEHOLDER"
    "${Prefix}client_deliverables.zip"         = "ZIP_PLACEHOLDER"
    "${Prefix}logs_archive_feb.tar.gz"         = "TARGZ_PLACEHOLDER"

    # ── Security & Certs (4 files) ──
    "${Prefix}server.pem"                      = "-----BEGIN CERTIFICATE-----`nMIIBxTCCAW...mocked...`n-----END CERTIFICATE-----"
    "${Prefix}api_key_staging.key"             = "sk-staging-abc123def456ghi789"
    "${Prefix}ssh_config_backup.txt"           = "Host myserver`n  HostName 192.168.1.100`n  User deploy"
    "${Prefix}ssl_cert_notes.txt"              = "Domain: example.com`nExpires: April 5`nAuto-renew: YES"

    # ── Media (4 files) ──
    "${Prefix}podcast_episode_42.mp3"          = "MP3_PLACEHOLDER"
    "${Prefix}meeting_recording_0320.mp4"      = "MP4_PLACEHOLDER"
    "${Prefix}notification_sound.wav"          = "WAV_PLACEHOLDER"
    "${Prefix}screen_recording_bug.mp4"        = "MP4_PLACEHOLDER"

    # ── Personal & Misc (8 files) ──
    "${Prefix}wifi_passwords.txt"              = "Office: CampusWifi2026`nHome: MyNetwork42"
    "${Prefix}shopping_list.txt"               = "Monitor arm, USB-C hub, desk lamp"
    "${Prefix}recipe_banana_bread.txt"         = "3 bananas, butter, sugar, flour. 350F 60min"
    "${Prefix}gym_routine.txt"                 = "Mon: Chest`nTue: Back`nWed: Rest`nThu: Legs"
    "${Prefix}book_list.txt"                   = "- Designing Data Apps`n- Staff Engineer`n- System Design v2"
    "${Prefix}flight_confirmation.txt"         = "UA1234 SFO->JFK Mar 28 8:15am Seat 12A"
    "${Prefix}doctor_appointment.txt"          = "Dr. Smith April 2 10:30am. Bring: insurance card"
    "${Prefix}car_maintenance_log.txt"         = "Oil change: Jan 15 (next July). Miles: 42350"

    # ── Junk / Typical Desktop Clutter (6 files) ──
    "${Prefix}random_notes.md"                 = "# Notes`n- Check paper`n- Cancel trial"
    "${Prefix}CHANGELOG.md"                    = "## v2.1.0 Added dark mode`n## v2.0.0 Redesign"
    "${Prefix}TODO.md"                         = "- [ ] Write tests`n- [x] Fix bug"
    "${Prefix}README.md"                       = "# My Project`nnpm install && npm start"
    "${Prefix}Untitled.txt"                    = ""
    "${Prefix}New Text Document.txt"           = "temp"
}

function Do-Create {
    Write-Host "Creating messy desktop files..." -ForegroundColor Cyan
    $count = 0
    foreach ($name in $Files.Keys) {
        $filePath = Join-Path $Desktop $name
        Set-Content -Path $filePath -Value $Files[$name] -Encoding UTF8
        $count++
    }
    Write-Host "Created $count files on Desktop." -ForegroundColor Green
}

function Do-Clean {
    Write-Host "Cleaning up test files and folders..." -ForegroundColor Cyan
    $removed = 0
    # Remove loose files on Desktop
    Get-ChildItem "$Desktop\${Prefix}*" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item $_.FullName -Force
        $removed++
    }
    # Remove files inside subfolders
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $testFiles = Get-ChildItem $_.FullName -Filter "${Prefix}*" -File -ErrorAction SilentlyContinue
        if ($testFiles) {
            $testFiles | ForEach-Object {
                Remove-Item $_.FullName -Force
                $removed++
            }
            if (-not (Get-ChildItem $_.FullName -ErrorAction SilentlyContinue)) {
                Remove-Item $_.FullName -Force
            }
        }
    }
    Write-Host "Removed $removed test files." -ForegroundColor Green
}

function Do-Verify {
    Write-Host "Verifying..." -ForegroundColor Cyan
    $totalFiles = $Files.Count
    $organized = 0
    $stillOnDesktop = @()

    $looseFiles = Get-ChildItem "$Desktop\${Prefix}*" -File -ErrorAction SilentlyContinue
    if ($looseFiles) {
        foreach ($f in $looseFiles) { $stillOnDesktop += $f.Name }
    }

    foreach ($name in $Files.Keys) {
        $matches = Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $name }
        }
        if ($matches) { $organized++ }
    }

    $foldersUsed = @{}
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $demoFiles = Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "${Prefix}*" }
        if ($demoFiles) { $foldersUsed[$_.Name] = $demoFiles.Count }
    }

    Write-Host "Total: $totalFiles  Organized: $organized  Loose: $($stillOnDesktop.Count)  Folders: $($foldersUsed.Count)"
    if ($organized -eq $totalFiles -and $stillOnDesktop.Count -eq 0 -and $foldersUsed.Count -ge 3) {
        Write-Host "PASS" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "FAIL" -ForegroundColor Red
        exit 1
    }
}

switch ($Action) {
    "create" { Do-Create }
    "clean"  { Do-Clean }
    "verify" { Do-Verify }
}
