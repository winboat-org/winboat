#Requires -Version 5.1
#Requires -RunAsAdministrator

param(
    [Parameter(Mandatory = $true)]
    [string]$PathPrefix,

    [Parameter(Mandatory = $true)]
    [string]$PathSuffix,

    [Parameter(Mandatory = $true)]
    [string]$Fields,

    [ValidateRange(1, 128)]
    [int]$Limit = 128
)

$ErrorActionPreference = 'Stop'
$root = $PathPrefix.TrimEnd('\', '/')
$relativePath = $PathSuffix.TrimStart('\', '/')
$selectedFields = @($Fields.Split(',') | ForEach-Object { $_.Trim() })
$apps = [System.Collections.Generic.List[PSCustomObject]]::new()

function Test-PathContainsReparsePoint {
    param(
        [string]$Root,
        [string]$RelativePath
    )

    $current = Get-Item -LiteralPath $Root -Force -ErrorAction Stop
    if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $true
    }
    foreach ($component in @($RelativePath.Split([char[]]@('\', '/'), [System.StringSplitOptions]::RemoveEmptyEntries))) {
        $current = Get-Item -LiteralPath (Join-Path -Path $current.FullName -ChildPath $component) -Force -ErrorAction Stop
        if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return $true
        }
    }
    return $false
}

if (Test-Path -LiteralPath $root -PathType Container) {
    if (Test-PathContainsReparsePoint -Root $root -RelativePath '') {
        throw 'pathPrefix must not be a reparse point'
    }
    $directories = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction Stop | Sort-Object -Property Name)
    foreach ($directory in $directories) {
        if ($apps.Count -ge $Limit) {
            break
        }

        $candidate = Join-Path -Path $directory.FullName -ChildPath $relativePath
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf -ErrorAction SilentlyContinue)) {
            continue
        }
        $relativeCandidate = Join-Path -Path $directory.Name -ChildPath $relativePath
        if (Test-PathContainsReparsePoint -Root $root -RelativePath $relativeCandidate) {
            continue
        }

        $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).ProviderPath
        $name = $null
        try {
            $name = (Get-Item -LiteralPath $resolved -ErrorAction Stop).VersionInfo.FileDescription
        } catch { }
        if (-not $name -or -not $name.Trim()) {
            $name = [System.IO.Path]::GetFileNameWithoutExtension($resolved)
        }

        $available = [ordered]@{
            Name   = $name.Trim()
            Path   = $resolved
            Source = 'filesystem'
        }
        $projected = [ordered]@{}
        foreach ($field in $selectedFields) {
            $projected[$field] = $available[$field]
        }
        $apps.Add([PSCustomObject]$projected)
    }
}

ConvertTo-Json -InputObject @($apps) -Depth 3 -Compress
