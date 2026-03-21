# CUA Screenshot Helper
# Takes a screenshot, resizes to target dimensions, outputs base64 JPEG

param(
    [int]$Width = 1280,
    [int]$Height = 720,
    [int]$Quality = 85
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# DPI awareness
$dpiCode = @"
using System.Runtime.InteropServices;
public class CuaDpi {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
Add-Type -TypeDefinition $dpiCode -ErrorAction SilentlyContinue
[CuaDpi]::SetProcessDPIAware() | Out-Null

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()

$resized = New-Object System.Drawing.Bitmap($bmp, $Width, $Height)
$bmp.Dispose()

$ms = New-Object System.IO.MemoryStream
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
$resized.Save($ms, $codec, $ep)
$resized.Dispose()

[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
