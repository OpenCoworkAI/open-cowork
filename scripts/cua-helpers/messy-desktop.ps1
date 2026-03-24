# messy-desktop.ps1 — Create a messy Desktop with mixed files for CUA benchmark
# Usage: powershell -ExecutionPolicy Bypass -File messy-desktop.ps1 [create|clean|verify]
#
# Creates 28 files: 12 real photos (Pexels) + 6 PIL images + 10 text files
# ALL with generic filenames — model must READ content to classify.
# 10 categories: food, nature, animals, architecture, receipts, charts,
#                code, meetings, recipes, job/resume

param(
    [Parameter(Position=0)]
    [ValidateSet("create", "clean", "verify")]
    [string]$Action = "create"
)

$Desktop = [Environment]::GetFolderPath("Desktop")
$Prefix = "demo_"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# File → category mapping (28 files, 10 categories)
$FileCategories = @{
    # Photos: Food (3)
    "${Prefix}IMG_4721.jpg"              = "food"
    "${Prefix}IMG_4803.jpg"              = "food"
    "${Prefix}IMG_5102.jpg"              = "food"
    # Photos: Nature (3)
    "${Prefix}DSC_0847.jpg"              = "nature"
    "${Prefix}DSC_1203.jpg"              = "nature"
    "${Prefix}DSC_1455.jpg"              = "nature"
    # Photos: Animals (3)
    "${Prefix}IMG_6001.jpg"              = "animals"
    "${Prefix}IMG_6042.jpg"              = "animals"
    "${Prefix}DSC_2001.jpg"              = "animals"
    # Photos: Architecture (3)
    "${Prefix}DSC_3010.jpg"              = "architecture"
    "${Prefix}DSC_3045.jpg"              = "architecture"
    "${Prefix}DSC_3088.jpg"              = "architecture"
    # Images: Receipts (3)
    "${Prefix}IMG_20260320_134522.jpg"   = "receipts"
    "${Prefix}IMG_20260318_091045.jpg"   = "receipts"
    "${Prefix}IMG_20260322_192300.jpg"   = "receipts"
    # Images: Charts (3)
    "${Prefix}Screenshot_2026-03-15.png" = "charts"
    "${Prefix}Screenshot_2026-03-18.png" = "charts"
    "${Prefix}Screenshot_2026-02-28.png" = "charts"
    # Text: Code (3)
    "${Prefix}draft_v2.py"               = "code"
    "${Prefix}untitled3.js"              = "code"
    "${Prefix}backup_old.py"             = "code"
    # Text: Meeting notes (3)
    "${Prefix}notes_monday.txt"          = "meetings"
    "${Prefix}sync_notes_0315.txt"       = "meetings"
    "${Prefix}allhands_feb.txt"          = "meetings"
    # Text: Recipes (2)
    "${Prefix}from_mom.txt"              = "recipes"
    "${Prefix}to_try_later.txt"          = "recipes"
    # Text: Job/Resume (2)
    "${Prefix}latest_draft.txt"          = "job"
    "${Prefix}cover_v3_final.txt"        = "job"
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
    Write-Host "Created $count files on Desktop (10 categories)." -ForegroundColor Green
}

function Do-Clean {
    Write-Host "Cleaning up demo files..." -ForegroundColor Cyan
    python (Join-Path $ScriptDir "generate_demo_images.py") clean

    # Also remove any folders that only contained demo files
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
    $totalFiles = $FileCategories.Count

    # Count loose files still on Desktop root
    $looseFiles = @()
    foreach ($name in $FileCategories.Keys) {
        if (Test-Path (Join-Path $Desktop $name)) {
            $looseFiles += $name
        }
    }

    # Count files in subfolders and check topic coherence
    $organized = 0
    $categoryFolders = @{}

    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $folderName = $_.Name
        $demoFiles = @(Get-ChildItem $_.FullName -Filter "${Prefix}*" -File -Recurse -ErrorAction SilentlyContinue)
        if ($demoFiles.Count -ge 1) {
            $categories = @()
            foreach ($f in $demoFiles) {
                $organized++
                $cat = $FileCategories[$f.Name]
                if ($cat -and $cat -notin $categories) {
                    $categories += $cat
                }
            }
            $categoryFolders[$folderName] = @{
                files = $demoFiles.Count
                categories = $categories
                coherent = ($categories.Count -le 2)  # allow merging 2 similar categories
            }
        }
    }

    $coherentFolders = ($categoryFolders.Values | Where-Object { $_.coherent }).Count
    $totalFolders = $categoryFolders.Count
    $pctOrganized = if ($totalFiles -gt 0) { [math]::Round($organized / $totalFiles * 100) } else { 0 }

    Write-Host ""
    Write-Host "Results:" -ForegroundColor White
    Write-Host "  Total files: $totalFiles"
    Write-Host "  Organized into folders: $organized ($pctOrganized%)"
    Write-Host "  Still loose on Desktop: $($looseFiles.Count)"
    Write-Host "  Folders used: $totalFolders"
    Write-Host "  Content-coherent folders: $coherentFolders / $totalFolders"
    Write-Host ""

    foreach ($folder in $categoryFolders.Keys | Sort-Object) {
        $info = $categoryFolders[$folder]
        $status = if ($info.coherent) { "[OK]" } else { "[MIXED]" }
        Write-Host "  $status $folder : $($info.files) files, categories: $($info.categories -join ', ')"
    }

    # PASS criteria:
    # 1. At least 60% of files moved into folders
    # 2. At least 4 folders used (10 categories, some merging OK)
    # 3. At least 3 folders are content-coherent
    $pass = ($organized -ge [math]::Floor($totalFiles * 0.6)) -and
            ($totalFolders -ge 4) -and
            ($coherentFolders -ge 3)

    Write-Host ""
    if ($pass) {
        Write-Host "PASS - Files organized by content!" -ForegroundColor Green
        exit 0
    } else {
        if ($coherentFolders -lt 3) {
            Write-Host "FAIL - Not enough coherent folders ($coherentFolders, need 3+)." -ForegroundColor Red
        } elseif ($organized -lt [math]::Floor($totalFiles * 0.6)) {
            Write-Host "FAIL - Not enough files organized ($organized / $totalFiles)." -ForegroundColor Red
        } else {
            Write-Host "FAIL - Not enough folders used ($totalFolders, need 4+)." -ForegroundColor Red
        }
        exit 1
    }
}

switch ($Action) {
    "create" { Do-Create }
    "clean"  { Do-Clean }
    "verify" { Do-Verify }
}
