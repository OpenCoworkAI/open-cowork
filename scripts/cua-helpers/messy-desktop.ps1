# messy-desktop.ps1 — Create a messy Desktop with image files for CUA benchmark
# Usage: powershell -ExecutionPolicy Bypass -File messy-desktop.ps1 [create|clean|verify]
#
# This version creates IMAGES with generic filenames (IMG_xxxx, DSC_xxxx, Screenshot_xxxx).
# The CUA model must OPEN and LOOK AT each image to classify them — demonstrating vision capability.
#
# 5 categories (13 images total):
#   Food photos (3), Nature/travel (3), Work charts (3), Receipts (2), UI screenshots (2)

param(
    [Parameter(Position=0)]
    [ValidateSet("create", "clean", "verify")]
    [string]$Action = "create"
)

$Desktop = [Environment]::GetFolderPath("Desktop")
$Prefix = "demo_"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Image filenames and their expected categories
$ImageCategories = @{
    # Food photos
    "${Prefix}IMG_4721.jpg"              = "food"
    "${Prefix}IMG_4803.jpg"              = "food"
    "${Prefix}IMG_5102.jpg"              = "food"
    # Nature/travel
    "${Prefix}DSC_0847.jpg"              = "nature"
    "${Prefix}DSC_1203.jpg"              = "nature"
    "${Prefix}DSC_1455.jpg"              = "nature"
    # Work charts
    "${Prefix}Screenshot_2026-03-15.png" = "charts"
    "${Prefix}Screenshot_2026-03-18.png" = "charts"
    "${Prefix}Screenshot_2026-02-28.png" = "charts"
    # Receipts
    "${Prefix}IMG_20260320_134522.jpg"   = "receipts"
    "${Prefix}IMG_20260318_091045.jpg"   = "receipts"
    # UI screenshots
    "${Prefix}Screenshot_20260322_103000.png" = "screenshots"
    "${Prefix}Screenshot_20260321_154530.png" = "screenshots"
}

function Do-Create {
    Write-Host "Generating demo images on Desktop..." -ForegroundColor Cyan
    $pyScript = Join-Path $ScriptDir "generate_demo_images.py"
    if (-not (Test-Path $pyScript)) {
        Write-Host "ERROR: generate_demo_images.py not found at $pyScript" -ForegroundColor Red
        exit 1
    }
    python $pyScript create
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Image generation failed" -ForegroundColor Red
        exit 1
    }
    $count = (Get-ChildItem "$Desktop\${Prefix}*" -File | Where-Object { $_.Extension -in '.jpg','.png' }).Count
    Write-Host "Created $count images on Desktop (5 categories)." -ForegroundColor Green
}

function Do-Clean {
    Write-Host "Cleaning up demo images..." -ForegroundColor Cyan
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
            # Remove empty dirs
            if (-not (Get-ChildItem $_.FullName -ErrorAction SilentlyContinue)) {
                Remove-Item $_.FullName -Force
            }
        }
    }
    Write-Host "Cleanup complete (removed $removed additional files)." -ForegroundColor Green
}

function Do-Verify {
    Write-Host "Verifying image organization..." -ForegroundColor Cyan
    $totalFiles = $ImageCategories.Count

    # Count loose files still on Desktop root
    $looseFiles = @()
    foreach ($name in $ImageCategories.Keys) {
        if (Test-Path (Join-Path $Desktop $name)) {
            $looseFiles += $name
        }
    }

    # Count files that moved into subfolders
    $organized = 0
    $categoryFolders = @{}  # folder -> list of categories found in it

    Get-ChildItem $Desktop -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $folderName = $_.Name
        $demoFiles = @(Get-ChildItem $_.FullName -Filter "${Prefix}*" -File -Recurse -ErrorAction SilentlyContinue)
        if ($demoFiles.Count -ge 1) {
            $categories = @()
            foreach ($f in $demoFiles) {
                $organized++
                $cat = $ImageCategories[$f.Name]
                if ($cat -and $cat -notin $categories) {
                    $categories += $cat
                }
            }
            $categoryFolders[$folderName] = @{
                files = $demoFiles.Count
                categories = $categories
                coherent = ($categories.Count -eq 1)  # all files in folder are same category
            }
        }
    }

    # Count how many folders are "coherent" (all files share one category)
    $coherentFolders = ($categoryFolders.Values | Where-Object { $_.coherent }).Count
    $totalFolders = $categoryFolders.Count

    $pctOrganized = if ($totalFiles -gt 0) { [math]::Round($organized / $totalFiles * 100) } else { 0 }

    Write-Host ""
    Write-Host "Results:" -ForegroundColor White
    Write-Host "  Total images: $totalFiles"
    Write-Host "  Organized into folders: $organized ($pctOrganized%)"
    Write-Host "  Still loose on Desktop: $($looseFiles.Count)"
    Write-Host "  Folders used: $totalFolders"
    Write-Host "  Content-coherent folders: $coherentFolders / $totalFolders"
    Write-Host ""

    foreach ($folder in $categoryFolders.Keys) {
        $info = $categoryFolders[$folder]
        $status = if ($info.coherent) { "[OK]" } else { "[MIXED]" }
        Write-Host "  $status $folder : $($info.files) files, categories: $($info.categories -join ', ')"
    }

    # PASS criteria:
    # 1. At least 60% of files moved into folders (model may miss some file types like .png)
    # 2. At least 3 folders used
    # 3. At least 2 folders are content-coherent (same-category files grouped together)
    #    This proves the model looked at images, not just sorted by extension
    $pass = ($organized -ge [math]::Floor($totalFiles * 0.6)) -and
            ($totalFolders -ge 3) -and
            ($coherentFolders -ge 2)

    Write-Host ""
    if ($pass) {
        Write-Host "PASS - Files organized by visual content!" -ForegroundColor Green
        exit 0
    } else {
        if ($coherentFolders -lt 2) {
            Write-Host "FAIL - Files moved but NOT grouped by content." -ForegroundColor Red
            Write-Host "  The model should LOOK AT each image and group similar content together." -ForegroundColor Yellow
        } elseif ($organized -lt [math]::Floor($totalFiles * 0.8)) {
            Write-Host "FAIL - Not enough files organized ($organized / $totalFiles)." -ForegroundColor Red
        } else {
            Write-Host "FAIL - Not enough folders used ($totalFolders, need 3+)." -ForegroundColor Red
        }
        exit 1
    }
}

switch ($Action) {
    "create" { Do-Create }
    "clean"  { Do-Clean }
    "verify" { Do-Verify }
}
