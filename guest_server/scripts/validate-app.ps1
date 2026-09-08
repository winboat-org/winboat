#Requires -Version 5.1

$ErrorActionPreference = 'Stop'
try {
    . "$PSScriptRoot/path-utils.ps1"
    [Console]::InputEncoding = [Text.Encoding]::UTF8
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $Target = [string]$request.path
    $Arguments = [string]$request.args

    if ($Arguments -match '^shell:AppsFolder\\([^!\s]+)!([^\s]+)$') {
        $family, $appId = $Matches[1], $Matches[2]
        $packages = @(Get-AppxPackage -AllUsers | Where-Object { $_.PackageFamilyName -eq $family })
        foreach ($package in $packages) {
            # Get-AppxPackageManifest can return nothing under SYSTEM for a user's
            # installed app. Read its manifest from disk, as app discovery does.
            $manifestPath = Join-Path -Path $package.InstallLocation -ChildPath 'AppxManifest.xml'
            if (-not (Test-LocalFilePath $manifestPath)) {
                'unknown'
                return
            }
            $manifest = [xml](Get-Content -LiteralPath $manifestPath -Raw)
            if (-not $manifest.Package.Applications) {
                'unknown'
                return
            }
            if ($manifest.Package.Applications.Application.Id -contains $appId) {
                'valid'
                return
            }
        }
        'missing'
        return
    }

    # The service runs as SYSTEM; it cannot resolve the interactive user's profile.
    if ($Target -match '%(USERPROFILE|APPDATA|LOCALAPPDATA|HOMEPATH|HOMEDRIVE)%') {
        'unknown'
        return
    }
    $expanded = [Environment]::ExpandEnvironmentVariables($Target)
    if ($expanded -match '%[^%]+%|[\p{Cc}]' -or $expanded -match '^[\\/]{2}') {
        'unknown'
    } elseif (Test-LocalFilePath $expanded) {
        if (Test-Path -LiteralPath $expanded -PathType Leaf) { 'valid' } else { 'missing' }
    } elseif ($expanded -match '^[\p{L}\p{N} _.-]+$') {
        $command = Get-Command -Name $expanded -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { 'valid' } else { 'unknown' }
    } else {
        'unknown'
    }
} catch {
    'unknown'
}
