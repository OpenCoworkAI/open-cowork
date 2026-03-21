# CUA Type Text Helper
# Types text by clipboard paste (Ctrl+V)

param(
    [string]$TextFile  # Path to file containing text to type
)

Add-Type -AssemblyName System.Windows.Forms

$saved = [System.Windows.Forms.Clipboard]::GetText()
$text = [System.IO.File]::ReadAllText($TextFile)
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 150
if ($saved) { [System.Windows.Forms.Clipboard]::SetText($saved) }

Write-Output "OK"
