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
# Prefix for safe cleanup — short enough to look natural in demo
$Prefix = "demo_"

# File definitions: realistic file names with real-looking content
$Files = @{
    # Documents — varied types a real person would have
    "${Prefix}Meeting Notes 03-22.txt"         = "Team Sync - March 22, 2026`n`nAttendees: Sarah, Mike, David, Lisa`n`nAgenda:`n1. Q2 roadmap review`n2. Budget allocation for new hires`n3. Product launch timeline`n`nKey Decisions:`n- Launch moved to May 15th`n- Two new engineering positions approved`n- Design review scheduled for next Thursday`n`nAction Items:`n- Sarah: Update project timeline by Friday`n- Mike: Prepare budget breakdown`n- David: Set up user testing sessions`n- Lisa: Draft press release outline"
    "${Prefix}Travel Expense Report.txt"       = "Business Trip - San Francisco`nDate: March 15-18, 2026`n`nFlights: `$842.00`nHotel (3 nights): `$1,290.00`nMeals: `$186.50`nUber/Taxi: `$94.30`nConference ticket: `$299.00`n`nTotal: `$2,711.80`nStatus: Pending approval"
    "${Prefix}Ideas for Q3 Features.txt"       = "Feature Ideas (brainstorm)`n`n1. Dark mode for mobile app`n2. Export to PDF functionality`n3. Multi-language support (start with Spanish, French)`n4. Collaborative editing (like Google Docs)`n5. Custom dashboard widgets`n6. API rate limiting improvements`n7. SSO integration for enterprise clients"
    "${Prefix}Interview Questions.docx"        = "DOCX_PLACEHOLDER"
    "${Prefix}Quarterly Report Q1 2026.pdf"    = "PDF_PLACEHOLDER"
    "${Prefix}Product Roadmap.pptx"            = "PPTX_PLACEHOLDER"
    "${Prefix}NDA Template.pdf"                = "PDF_PLACEHOLDER"

    # Code / Config — realistic dev files
    "${Prefix}data_pipeline.py"                = "import pandas as pd`nimport json`nfrom pathlib import Path`n`ndef load_config(path='config.yaml'):`n    with open(path) as f:`n        return yaml.safe_load(f)`n`ndef process_batch(df, batch_size=1000):`n    for i in range(0, len(df), batch_size):`n        batch = df.iloc[i:i+batch_size]`n        yield batch.to_dict('records')`n`nif __name__ == '__main__':`n    config = load_config()`n    df = pd.read_csv(config['input_path'])`n    for batch in process_batch(df):`n        print(f'Processed {len(batch)} records')"
    "${Prefix}api_endpoints.js"                = "const express = require('express');`nconst router = express.Router();`n`nrouter.get('/users', async (req, res) => {`n  const users = await User.findAll();`n  res.json(users);`n});`n`nrouter.post('/users', async (req, res) => {`n  const user = await User.create(req.body);`n  res.status(201).json(user);`n});`n`nmodule.exports = router;"
    "${Prefix}docker-compose.yml"              = "version: '3.8'`nservices:`n  web:`n    build: .`n    ports:`n      - '3000:3000'`n    environment:`n      - DATABASE_URL=postgres://db:5432/app`n    depends_on:`n      - db`n  db:`n    image: postgres:15`n    volumes:`n      - pgdata:/var/lib/postgresql/data`nvolumes:`n  pgdata:"
    "${Prefix}app_config.json"                 = "{`n  `"app_name`": `"CUA Dashboard`",`n  `"version`": `"2.1.0`",`n  `"api_base`": `"https://api.example.com/v2`",`n  `"features`": {`n    `"dark_mode`": true,`n    `"analytics`": true,`n    `"beta_features`": false`n  },`n  `"max_retries`": 3,`n  `"timeout_ms`": 5000`n}"

    # Data — spreadsheet-like files
    "${Prefix}Sales Report March.csv"          = "Region,Product,Units,Revenue,Growth`nNorth America,Widget Pro,1250,`$62500,12%`nEurope,Widget Pro,890,`$44500,8%`nAsia Pacific,Widget Pro,2100,`$105000,23%`nNorth America,Widget Lite,3400,`$51000,5%`nEurope,Widget Lite,1800,`$27000,-2%`nAsia Pacific,Widget Lite,4200,`$63000,18%"
    "${Prefix}User Analytics.csv"              = "Date,DAU,MAU,Sessions,Avg Duration (min),Bounce Rate`n2026-03-01,12450,89200,34500,8.2,32%`n2026-03-08,13100,91000,36200,8.5,30%`n2026-03-15,14200,94500,39800,9.1,28%`n2026-03-22,15800,98000,42100,9.4,26%"
    "${Prefix}Customer Feedback.csv"           = "ID,Customer,Rating,Category,Comment`n1,Acme Corp,4,Performance,Very fast response times`n2,TechStart Inc,5,Features,Love the new dashboard`n3,Global Ltd,3,UX,Navigation could be simpler`n4,DataFlow,4,Support,Quick resolution on tickets`n5,CloudBase,2,Reliability,Experienced downtime twice"

    # Images — screenshots and design assets
    "${Prefix}dashboard_mockup_v3.png"         = "PNG_PLACEHOLDER"
    "${Prefix}bug_screenshot_login.png"        = "PNG_PLACEHOLDER"
    "${Prefix}team_photo_offsite.jpg"          = "JFIF_PLACEHOLDER"
    "${Prefix}logo_redesign_final.png"         = "PNG_PLACEHOLDER"

    # Logs
    "${Prefix}server_error_2026-03-20.log"     = "[2026-03-20 14:32:01] ERROR: Connection pool exhausted (max=50, active=50)`n[2026-03-20 14:32:01] ERROR: Request /api/users timed out after 30000ms`n[2026-03-20 14:32:05] WARN: Retrying connection to db-primary (attempt 2/3)`n[2026-03-20 14:32:08] INFO: Connection restored, 3 queued requests processed`n[2026-03-20 14:33:15] ERROR: OOM killer invoked on worker-7 (RSS: 2.1GB)`n[2026-03-20 14:33:16] INFO: Worker-7 restarted successfully"
    "${Prefix}deploy_log_v2.1.log"             = "=== Deployment v2.1.0 - 2026-03-19 ===`n[09:00:01] Starting deployment pipeline...`n[09:00:15] Running test suite: 247 passed, 0 failed`n[09:01:02] Building Docker image: sha256:a3f8b2c...`n[09:02:30] Pushing to registry... done`n[09:03:00] Rolling update: 0/4 pods updated`n[09:03:45] Rolling update: 2/4 pods updated`n[09:04:30] Rolling update: 4/4 pods updated`n[09:04:31] Health check: all endpoints responding`n[09:04:32] Deployment complete. Version 2.1.0 is live."

    # Misc — the kind of random files that pile up
    "${Prefix}wifi_passwords.txt"              = "Office: CupertinoCampus2026`nGuest: Welcome2Visit`nHome: MyHomeNetwork!42`nCafe downstairs: coffee4free"
    "${Prefix}bookmarks_export.html"           = "<html><head><title>Bookmarks</title></head><body><h1>Bookmarks</h1><ul><li><a href='https://github.com'>GitHub</a></li><li><a href='https://arxiv.org'>arXiv</a></li><li><a href='https://news.ycombinator.com'>Hacker News</a></li></ul></body></html>"
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
    Write-Host ""
    Write-Host "Files created:" -ForegroundColor Yellow
    Get-ChildItem "$Desktop\${Prefix}*" | ForEach-Object { Write-Host "  $($_.Name)" }
}

function Do-Clean {
    Write-Host "Cleaning up test files and folders..." -ForegroundColor Cyan
    $removed = 0
    # Remove loose files on Desktop
    Get-ChildItem "$Desktop\${Prefix}*" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item $_.FullName -Force
        $removed++
    }
    # Remove organized folders — check ALL subfolders for prefixed files
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $testFiles = Get-ChildItem $_.FullName -Filter "${Prefix}*" -File -ErrorAction SilentlyContinue
        if ($testFiles) {
            $testFiles | ForEach-Object {
                Remove-Item $_.FullName -Force
                $removed++
            }
            # Remove folder only if empty after cleanup
            if (-not (Get-ChildItem $_.FullName -ErrorAction SilentlyContinue)) {
                Remove-Item $_.FullName -Force
            }
        }
    }
    Write-Host "Removed $removed test files." -ForegroundColor Green
}

function Do-Verify {
    Write-Host "Verifying file organization..." -ForegroundColor Cyan
    Write-Host ""

    $totalFiles = $Files.Count
    $organized = 0
    $stillOnDesktop = @()

    # Check: no test files should remain loose on Desktop
    $looseFiles = Get-ChildItem "$Desktop\${Prefix}*" -File -ErrorAction SilentlyContinue
    if ($looseFiles) {
        foreach ($f in $looseFiles) {
            $stillOnDesktop += $f.Name
        }
    }

    # Check: each file should be in some subfolder of Desktop
    foreach ($name in $Files.Keys) {
        # Search recursively in all subfolders (depth 2 is enough)
        $matches = Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $name }
        }
        if ($matches) { $organized++ }
    }

    # Count how many DISTINCT folders contain demo files (1 folder = not really organized)
    $foldersUsed = @{}
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $demoFiles = Get-ChildItem $_.FullName -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "${Prefix}*" }
        if ($demoFiles) { $foldersUsed[$_.Name] = $demoFiles.Count }
    }
    $numFolders = $foldersUsed.Count

    # Results
    Write-Host "=== Verification Results ===" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Total test files:       $totalFiles"
    Write-Host "Organized into folders: $organized" -ForegroundColor $(if ($organized -eq $totalFiles) { "Green" } else { "Yellow" })
    Write-Host "Still on Desktop:       $($stillOnDesktop.Count)" -ForegroundColor $(if ($stillOnDesktop.Count -eq 0) { "Green" } else { "Red" })
    Write-Host "Folders used:           $numFolders" -ForegroundColor $(if ($numFolders -ge 3) { "Green" } elseif ($numFolders -ge 2) { "Yellow" } else { "Red" })
    Write-Host ""

    if ($numFolders -le 1 -and $organized -gt 0) {
        Write-Host "WARNING: All files dumped into 1 folder - not organized by type!" -ForegroundColor Red
        Write-Host ""
    }

    if ($stillOnDesktop.Count -gt 0) {
        Write-Host "Files NOT organized:" -ForegroundColor Red
        foreach ($f in $stillOnDesktop) { Write-Host "  $f" }
        Write-Host ""
    }

    # Show folder structure
    Write-Host "Folder structure:" -ForegroundColor Cyan
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $testFiles = Get-ChildItem $_.FullName -Filter "${Prefix}*" -ErrorAction SilentlyContinue
        if ($testFiles) {
            Write-Host "  $($_.Name)/" -ForegroundColor Green
            foreach ($f in $testFiles) {
                Write-Host "    $($f.Name)"
            }
        }
    }

    # Final score
    $score = [math]::Round(($organized / $totalFiles) * 100)
    Write-Host ""
    $scoreText = 'Score: ' + $organized + '/' + $totalFiles + ' (' + $score + '%)'
    Write-Host $scoreText -ForegroundColor $(if ($score -ge 80) { "Green" } elseif ($score -ge 50) { "Yellow" } else { "Red" })

    if ($organized -eq $totalFiles -and $stillOnDesktop.Count -eq 0 -and $numFolders -ge 3) {
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
