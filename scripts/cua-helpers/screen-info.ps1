# CUA Screen Info Helper
# Returns screen dimensions in "width height" format

$dpiCode = @"
using System.Runtime.InteropServices;
public class CuaDpi {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition $dpiCode -ErrorAction SilentlyContinue
[CuaDpi]::SetProcessDPIAware() | Out-Null

$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "$($s.Width) $($s.Height)"
