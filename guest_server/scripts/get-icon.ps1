#Requires -Version 5.1

# WinBoat - Icon Extraction Helper
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File icon.ps1 "C:\Path\To\Something.exe"
#   powershell -ExecutionPolicy Bypass -File icon.ps1 "C:\Path\To\Shortcut.lnk" -Size 48
#
# Output:
#   Writes a Base64-encoded PNG of the associated icon to stdout.
#   If extraction fails, outputs a small transparent PNG as fallback.

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path,

    [Parameter(Mandatory = $false)]
    [ValidateRange(16, 512)]
    [int]$Size = 128
)

# Suppress non-terminating errors to keep stdout clean (only base64 should be printed)
$ErrorActionPreference = 'SilentlyContinue'

# Load System.Drawing for icon extraction/conversion
Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

# Default transparent 256x256 PNG as Base64 (used if extraction fails)
$defaultIconBase64 = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAABiVBMVEUAAABzc3N5eXl0dHR5dnN5dnN4eHV5d3V6eHR5d3V6eHR5d3R5d3R5d3R5d3R5d3R5d3R5d3R5d3R5d3R5d3QGabwGar0Ha70Ha74HbL4HbL8Hbb8HbcAIbsAIbsEIb8EIcMIJccIJccMJcsMJcsQJc8QKc8UKdMUKdMYKdcYKdscLdscLd8cLd8gLeMgLeMkLeckMecoMesoMessMe8sMe8wMfMwNfMwNfcwNfc0Nfs0Nfs4Nf84Of88OgM8OgNAOgdAOgdEOgtEPgtEPg9IPhNIPhNMPhdMQhdQQhtQQhtUQh9UQh9YRiNYRidcRitcRitgSi9gSi9kSjNkSjNoSjdoSjdsTjtsTj9wed8IeeMMfecMpmd4qmd8qmt94rdl5d3R5rtp8end+wep/weqHhYOMi4iOjIqPjYqPjYuWlpbAv77BwL7Cwb/CwcDDwsHEw8LExMTPz87Q0M/S0dDX19bY19bk5OPl5eTx8PDx8fHz8/Lz8/P09PP09vj09/n4+Pj6+vr///+Z/ULnAAAAFXRSTlMAFBUWUlRVgYKDhM3Oz9Dw8fLz9P7FJ1F0AAAAAWJLR0SCi7P/RAAAAtFJREFUeNrt2s1qE1EYxvGZTGfSIEYKQhYigqtcSN2IVi/BO2z9WHotomIXorQS05JkpplmalyIbmrz2ff3h1C6aJnzz/O85+S0SQIAAAAAAAAAAAAAAG476eyVtbPiebiVvx1fTC6uBBR3XgR9918PyyRLiu5B1Pj3P5fTNOve9vd/b/Y6/cfXhqNBqx01/1e8LFo7sTeBnegC8vRV8HNAKyEg+BC4KkK3k4dbeTkaTOYC8vu7EcdfXnwrf1Wguxsz/e278xnQidr/zlxAHlVAYRcggAACCCCAAAIIIIAAAgggICZ//1ng6zV+uvfnt9Mv5WTpT5y3H7QW9cCLTsDx2fLXn5TD4+UmoPf/v2xcryS1o4U98KITMFlNbUtDcKkVuAE1Ac4BBKiABEiABEiABEhAzPuA9QjYoPuA21GB3rYtoWcGEGAbJIAAM0ACCFABAlSAABVY633AerjZA0uA+wDboF3ADFABJ0EzwAwwA8wAAgxBM0ACknD/H+AcsMiP1+sR0DMDCLANEqACBKiABEgAASpAgAq4D7jmJ0cVWPDH6627DzADnAPMABUgwAzwWcAQNAPMADPADDADtvM+QAU25z5AAgiwCxCgAgSoAAEEmAESIAEERLwPMAPcB5gBBJgBBKiABEiABEiABEgAASoQ7z7ADIh+H2AGqAABBJgBBKgAASpAgApIgARIgARIgAQQoAIEqEAkAfureeYnG1uBfDUdKDZWwKOnk/dLX/5+8XBjBWSPk74hSAABBBBAAAEEEEAAAVsjoIy6+MlcQBVVQDUXcBZVwPB3AuqY66+bBGSf+rMkdEIKODlPkqNWY2EQsgTDpgHVTiNg+n28l0bL/8lw2uyAWf1xdotVj0ejNI1zJqhGp4PzZvIdnqdJfu9Z2FPQux9VlkzLD/2g6z/8WSVN9VtF1j4It/o342pSJwAAAAAAAAAAAAAAIACXIfSz2zOYD54AAAAASUVORK5CYII="

function Write-FallbackBase64 {
    Write-Output $defaultIconBase64
}

function Resolve-LnkTargetPath {
    param([string]$lnkPath)

    if (-not (Test-Path -LiteralPath $lnkPath -PathType Leaf)) { return $null }
    try {
        $shell = New-Object -ComObject WScript.Shell -Strict
        try {
            $shortcut = $shell.CreateShortcut($lnkPath)
            if ($shortcut -and $shortcut.IconLocation) {
                # IconLocation can be "path,index"; prefer the icon file path if present
                $iconSpec = $shortcut.IconLocation
                $iconPath = $iconSpec.Split(',')[0]
                if ($iconPath -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
                    return $iconPath
                }
            }
            if ($shortcut -and $shortcut.TargetPath) {
                return $shortcut.TargetPath
            }
        } finally {
            if ($shell) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null }
        }
    } catch { }
    return $null
}

function Get-IconBase64FromFile {
    param(
        [string]$filePath,
        [int]$size
    )

    if (-not [System.Drawing.Icon]) { return $null }

    try {
        # Handle .ico files explicitly for best fidelity
        $ext = [System.IO.Path]::GetExtension($filePath)
        if ($ext -and $ext.Equals('.ico', [System.StringComparison]::OrdinalIgnoreCase)) {
            $ico = New-Object System.Drawing.Icon($filePath)
        } else {
            $ico = [System.Drawing.Icon]::ExtractAssociatedIcon($filePath)
        }
        if ($null -eq $ico) { return $null }

        $bmp = $ico.ToBitmap()
        $resizedBmp = New-Object System.Drawing.Bitmap($size, $size)
        $graphics = [System.Drawing.Graphics]::FromImage($resizedBmp)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($bmp, 0, 0, $size, $size)

        $stream = New-Object System.IO.MemoryStream
        $resizedBmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $base64 = [Convert]::ToBase64String($stream.ToArray())

        $stream.Dispose()
        $graphics.Dispose()
        $resizedBmp.Dispose()
        $bmp.Dispose()
        $ico.Dispose()

        return $base64
    } catch {
        return $null
    }
}

# Expand %VAR% environment variables without evaluating PowerShell expressions
$expandedPath = try { [System.Environment]::ExpandEnvironmentVariables($Path) } catch { $Path }

# Resolve .lnk shortcuts first if the given path ends with .lnk
$candidatePath = $expandedPath
if ($candidatePath -like '*.lnk') {
    $lnkTarget = Resolve-LnkTargetPath -lnkPath $candidatePath
    if ($lnkTarget) { $candidatePath = $lnkTarget }
}

# Resolve to a filesystem path if possible
$resolvedPath = try { (Resolve-Path -LiteralPath $candidatePath -ErrorAction SilentlyContinue).ProviderPath } catch { $null }
if (-not $resolvedPath) { $resolvedPath = $candidatePath }

# Ensure target exists and is a file
if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
    Write-FallbackBase64
    exit 0
}

$result = Get-IconBase64FromFile -filePath $resolvedPath -size $Size
if ($result) {
    Write-Output $result
} else {
    Write-FallbackBase64
}

exit 0
