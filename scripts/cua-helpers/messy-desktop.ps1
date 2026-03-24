# messy-desktop.ps1 — Create a messy Desktop with 35 mixed files for CUA benchmark
# Usage: powershell -ExecutionPolicy Bypass -File messy-desktop.ps1 [create|clean|verify]
#
# 5 themes x 7 files = 35 total (photos + charts + code + text + data)
# Model must READ each file's content to classify — filenames are deliberately generic.

param(
    [Parameter(Position=0)]
    [ValidateSet("create", "clean", "verify")]
    [string]$Action = "create"
)

$Desktop = [Environment]::GetFolderPath("Desktop")
$Prefix = "demo_"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# File → theme mapping (35 files, 5 themes)
$FileThemes = @{
    # Japan Trip (7)
    "${Prefix}IMG_4721.jpg"              = "japan"
    "${Prefix}IMG_4856.jpg"              = "japan"
    "${Prefix}screenshot_0315.png"       = "japan"
    "${Prefix}notes_0318.txt"            = "japan"
    "${Prefix}budget_v2.csv"             = "japan"
    "${Prefix}phrases.txt"               = "japan"
    "${Prefix}checklist.md"              = "japan"
    # Work Dashboard (7)
    "${Prefix}wireframe_02.png"          = "dashboard"
    "${Prefix}app_v3.js"                 = "dashboard"
    "${Prefix}query_final.sql"           = "dashboard"
    "${Prefix}meeting_notes_0320.txt"    = "dashboard"
    "${Prefix}metrics_q1.csv"            = "dashboard"
    "${Prefix}response_sample.json"      = "dashboard"
    "${Prefix}review_comments.md"        = "dashboard"
    # ML Course (7)
    "${Prefix}plot_results.png"          = "ml"
    "${Prefix}confusion_mtx.png"         = "ml"
    "${Prefix}train_v2.py"              = "ml"
    "${Prefix}homework3.py"             = "ml"
    "${Prefix}lecture_0312.txt"          = "ml"
    "${Prefix}dataset_clean.csv"        = "ml"
    "${Prefix}config.json"              = "ml"
    # Moving/Apartment (7)
    "${Prefix}IMG_5102.jpg"              = "moving"
    "${Prefix}IMG_5118.jpg"              = "moving"
    "${Prefix}floorplan_v2.png"          = "moving"
    "${Prefix}comparison.csv"            = "moving"
    "${Prefix}todo_list.txt"             = "moving"
    "${Prefix}expenses.json"             = "moving"
    "${Prefix}inventory.md"              = "moving"
    # Fitness Plan (7)
    "${Prefix}IMG_5234.jpg"              = "fitness"
    "${Prefix}IMG_5301.jpg"              = "fitness"
    "${Prefix}progress_chart.png"        = "fitness"
    "${Prefix}log_march.csv"             = "fitness"
    "${Prefix}meal_plan.txt"             = "fitness"
    "${Prefix}tracker.json"              = "fitness"
    "${Prefix}routine.py"                = "fitness"
}

function Do-Create {
    Write-Host "Generating demo files on Desktop..." -ForegroundColor Cyan
    $pyScript = Join-Path $ScriptDir "generate_demo_images.py"
    if (-not (Test-Path $pyScript)) {
        Write-Host "ERROR: generate_demo_images.py not found at $pyScript" -ForegroundColor Red
        exit 1
    }
    python $pyScript create
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: File generation failed" -ForegroundColor Red
        exit 1
    }
    $count = (Get-ChildItem "$Desktop\${Prefix}*" -File -ErrorAction SilentlyContinue).Count
    Write-Host "Created $count files on Desktop (5 themes x 7 files)." -ForegroundColor Green
}

function Do-Clean {
    Write-Host "Cleaning up demo files..." -ForegroundColor Cyan
    python (Join-Path $ScriptDir "generate_demo_images.py") clean

    $removed = 0
    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $demoFiles = Get-ChildItem $_.FullName -Filter "${Prefix}*" -File -Recurse -ErrorAction SilentlyContinue
        if ($demoFiles) {
            $demoFiles | ForEach-Object {
                Remove-Item $_.FullName -Force
                $removed++
            }
            if (-not (Get-ChildItem $_.FullName -ErrorAction SilentlyContinue)) {
                Remove-Item $_.FullName -Force
            }
        }
    }
    Write-Host "Cleanup complete (removed $removed additional files)." -ForegroundColor Green
}

function Do-Verify {
    Write-Host "Verifying file organization..." -ForegroundColor Cyan
    $totalFiles = $FileThemes.Count

    # Count loose files
    $looseCount = 0
    foreach ($name in $FileThemes.Keys) {
        if (Test-Path (Join-Path $Desktop $name)) { $looseCount++ }
    }

    # Analyze folders — check ALL directories recursively (model may nest: Desktop/projects/JapanTrip/...)
    $organized = 0
    $folderInfo = @{}

    # Get all directories at any depth that contain demo files
    $allDirs = Get-ChildItem $Desktop -Directory -Recurse -ErrorAction SilentlyContinue
    foreach ($dir in $allDirs) {
        # Only count leaf directories (those with demo files directly inside, not subdirs)
        $demoFiles = @(Get-ChildItem $dir.FullName -Filter "${Prefix}*" -File -ErrorAction SilentlyContinue)
        if ($demoFiles.Count -ge 1) {
            $themes = @()
            foreach ($f in $demoFiles) {
                $organized++
                $t = $FileThemes[$f.Name]
                if ($t -and $t -notin $themes) { $themes += $t }
            }
            $folderInfo[$dir.Name] = @{
                files = $demoFiles.Count
                themes = $themes
                coherent = ($themes.Count -le 2)  # allow merging 2 related themes
            }
        }
    }

    $coherent = ($folderInfo.Values | Where-Object { $_.coherent }).Count
    $totalFolders = $folderInfo.Count
    $pct = if ($totalFiles -gt 0) { [math]::Round($organized / $totalFiles * 100) } else { 0 }

    Write-Host ""
    Write-Host "Results:" -ForegroundColor White
    Write-Host "  Total files: $totalFiles"
    Write-Host "  Organized: $organized ($pct%)"
    Write-Host "  Loose: $looseCount"
    Write-Host "  Folders: $totalFolders"
    Write-Host "  Theme-coherent: $coherent / $totalFolders"
    Write-Host ""

    foreach ($folder in $folderInfo.Keys | Sort-Object) {
        $info = $folderInfo[$folder]
        $status = if ($info.coherent) { "[OK]" } else { "[MIXED]" }
        Write-Host "  $status $folder : $($info.files) files, themes: $($info.themes -join ', ')"
    }

    # PASS: 60%+ organized, 3+ folders, 3+ coherent
    $pass = ($organized -ge [math]::Floor($totalFiles * 0.6)) -and
            ($totalFolders -ge 3) -and
            ($coherent -ge 3)

    Write-Host ""
    if ($pass) {
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
