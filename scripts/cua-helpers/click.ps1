# CUA Click Helper
# Performs a mouse click at the specified coordinates

param(
    [int]$X,
    [int]$Y,
    [string]$Button = "left"
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
Start-Sleep -Milliseconds 50

if ($Button -eq "right") {
    [CuaInput]::mouse_event(0x0008, 0, 0, 0, 0)  # RIGHTDOWN
    [CuaInput]::mouse_event(0x0010, 0, 0, 0, 0)  # RIGHTUP
} else {
    [CuaInput]::mouse_event(0x0002, 0, 0, 0, 0)  # LEFTDOWN
    [CuaInput]::mouse_event(0x0004, 0, 0, 0, 0)  # LEFTUP
}

Write-Output "OK"
