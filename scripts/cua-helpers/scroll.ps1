# CUA Scroll Helper
# Scrolls at the specified coordinates

param(
    [int]$X,
    [int]$Y,
    [string]$Direction,
    [int]$Amount = 3
)

$inputCode = @"
using System;
using System.Runtime.InteropServices;
public class CuaInput {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
Add-Type -TypeDefinition $inputCode -ErrorAction SilentlyContinue

[CuaInput]::SetCursorPos($X, $Y)

$isHorizontal = ($Direction -eq "left") -or ($Direction -eq "right")

if ($isHorizontal) {
    $flag = 0x1000  # MOUSEEVENTF_HWHEEL
    if ($Direction -eq "right") { $delta = 120 * $Amount } else { $delta = -120 * $Amount }
} else {
    $flag = 0x0800  # MOUSEEVENTF_WHEEL
    if ($Direction -eq "up") { $delta = 120 * $Amount } else { $delta = -120 * $Amount }
}

[CuaInput]::mouse_event($flag, 0, 0, $delta, 0)

Write-Output "OK"
