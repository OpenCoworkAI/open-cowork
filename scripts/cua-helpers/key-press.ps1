# CUA Key Press Helper
# Presses a key with optional modifiers

param(
    [string]$Key,
    [string[]]$Modifiers = @()
)

$inputCode = @"
using System;
using System.Runtime.InteropServices;
public class CuaInput {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@
Add-Type -TypeDefinition $inputCode -ErrorAction SilentlyContinue

$vkMap = @{
    "enter" = 0x0D; "return" = 0x0D; "tab" = 0x09; "escape" = 0x1B; "esc" = 0x1B
    "backspace" = 0x08; "delete" = 0x2E; "space" = 0x20
    "up" = 0x26; "down" = 0x28; "left" = 0x25; "right" = 0x27
    "home" = 0x24; "end" = 0x23; "pageup" = 0x21; "pagedown" = 0x22
    "f1" = 0x70; "f2" = 0x71; "f3" = 0x72; "f4" = 0x73; "f5" = 0x74
    "f6" = 0x75; "f7" = 0x76; "f8" = 0x77; "f9" = 0x78; "f10" = 0x79
    "f11" = 0x7A; "f12" = 0x7B
}

$lk = $Key.ToLower()
if ($vkMap.ContainsKey($lk)) {
    $vk = $vkMap[$lk]
} elseif ($lk.Length -eq 1) {
    $vk = [int][char]$lk.ToUpper()
} else {
    Write-Error "Unknown key: $Key"
    exit 1
}

# Press modifiers down
foreach ($mod in $Modifiers) {
    switch ($mod.ToLower()) {
        { $_ -in "ctrl","control" } { [CuaInput]::keybd_event(0x11, 0, 0, 0) }
        "alt"                       { [CuaInput]::keybd_event(0x12, 0, 0, 0) }
        "shift"                     { [CuaInput]::keybd_event(0x10, 0, 0, 0) }
        { $_ -in "win","cmd","meta" } { [CuaInput]::keybd_event(0x5B, 0, 0, 0) }
    }
}

# Press and release key
[CuaInput]::keybd_event($vk, 0, 0, 0)
[CuaInput]::keybd_event($vk, 0, 2, 0)

# Release modifiers (reverse order)
$reversed = @($Modifiers)
[Array]::Reverse($reversed)
foreach ($mod in $reversed) {
    switch ($mod.ToLower()) {
        { $_ -in "ctrl","control" } { [CuaInput]::keybd_event(0x11, 0, 2, 0) }
        "alt"                       { [CuaInput]::keybd_event(0x12, 0, 2, 0) }
        "shift"                     { [CuaInput]::keybd_event(0x10, 0, 2, 0) }
        { $_ -in "win","cmd","meta" } { [CuaInput]::keybd_event(0x5B, 0, 2, 0) }
    }
}

Write-Output "OK"
