function Test-LocalFilePath {
    param([string]$Path)

    return $Path -match '^[A-Za-z]:[\\/]' -and $Path -notmatch '[\p{Cc}]'
}
