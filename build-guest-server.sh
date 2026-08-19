#!/bin/bash
set -e

echo "Building WinBoat guest binaries..."

# Variables
export GOOS=windows
export GOARCH=amd64
export VERSION="$(bun -p "require('./package.json').version")"
export COMMIT_HASH="$(git rev-parse --short HEAD)"
export BUILD_TIMESTAMP=$(date '+%Y-%m-%dT%H:%M:%S')

# Helios WDDM bundle at 7e0e6b73
HELIOS_REPOSITORY="winboat-org/helios"
HELIOS_RUN_ID="31701467522"
HELIOS_ARTIFACT="helios-windows-x64-22.22.259.0"
HELIOS_DOWNLOAD_DIR=""

cleanup() {
    [ -z "$HELIOS_DOWNLOAD_DIR" ] || rm -rf -- "$HELIOS_DOWNLOAD_DIR"
}
trap cleanup EXIT

if [ -z "${HELIOS_BUNDLE:-}" ]; then
    command -v gh >/dev/null || { echo "GitHub CLI is required to download the Helios bundle." >&2; exit 1; }
    HELIOS_DOWNLOAD_DIR=$(mktemp -d)
    echo "Downloading Helios bundle from ${HELIOS_REPOSITORY} run ${HELIOS_RUN_ID}..."
    gh run download "$HELIOS_RUN_ID" \
        --repo "$HELIOS_REPOSITORY" \
        --name "$HELIOS_ARTIFACT" \
        --dir "$HELIOS_DOWNLOAD_DIR"
    HELIOS_BUNDLE=$(find "$HELIOS_DOWNLOAD_DIR" -maxdepth 1 -type f -name '*.zip' -print -quit | tr -d '\r')
    [ -n "$HELIOS_BUNDLE" ] || { echo "Downloaded Helios artifact did not contain a bundle." >&2; exit 1; }
    [ -f "$HELIOS_BUNDLE.sha256" ] || { echo "Downloaded Helios bundle has no checksum." >&2; exit 1; }
    ( cd "$HELIOS_DOWNLOAD_DIR" && sed -i "s/\r$//" "$(basename "$HELIOS_BUNDLE").sha256" && sha256sum -c "$(basename "$HELIOS_BUNDLE").sha256" )
elif [ ! -f "$HELIOS_BUNDLE" ]; then
    echo "Helios bundle not found: $HELIOS_BUNDLE" >&2
    exit 1
fi
HELIOS_BUNDLE=$(realpath "$HELIOS_BUNDLE")
LDFLAGS=(
    "-X 'main.Version=${VERSION}'"
    "-X 'main.CommitHash=${COMMIT_HASH}'"
    "-X 'main.BuildTimestamp=${BUILD_TIMESTAMP}'"
)

echo "Version: ${VERSION}"
echo "Commit Hash: ${COMMIT_HASH}"
echo "Build Timestamp: ${BUILD_TIMESTAMP}"

# Enter build directory
cd guest_server

# Verify nssm.exe integrity
echo "Verifying nssm.exe integrity..."
if [ -f "nssm.exe" ] && [ -f "nssm.sha1.txt" ]; then
    COMPUTED_HASH=$(sha1sum nssm.exe | cut -d' ' -f1)
    EXPECTED_HASH=$(cat nssm.sha1.txt | tr -d '[:space:]')

    if [ "$COMPUTED_HASH" = "$EXPECTED_HASH" ]; then
        echo "✓ nssm.exe integrity verified (SHA-1: $COMPUTED_HASH)"
    else
        echo "✗ nssm.exe integrity check FAILED!"
        echo "  Expected: $EXPECTED_HASH"
        echo "  Computed: $COMPUTED_HASH"
        exit 1
    fi
else
    echo "⚠ Warning: nssm.exe or nssm.sha1.txt not found, skipping integrity check"
fi

# Lay out a clean distributable:
#   dist/oem/    - the guest install payload (copied to C:\OEM, mounted into the VM)
#   dist/update/ - the host-side update payload pushed to the Guest Server Updater
DIST=dist
rm -rf "$DIST"
mkdir -p "$DIST/oem/server/scripts" "$DIST/oem/updater" "$DIST/update"

# Build both guest binaries
echo "Building guest server..."
go build -ldflags="${LDFLAGS[*]}" -o "$DIST/oem/server/winboat_guest_server.exe" ./cmd/server
echo "Building guest server updater..."
go build -ldflags="${LDFLAGS[*]}" -o "$DIST/oem/updater/winboat_guest_server_updater.exe" ./cmd/updater

# Runtime assets that ship inside server\ (these get updated alongside the exe)
cp scripts/apps.ps1 scripts/get-icon.ps1 scripts/time-sync.bat "$DIST/oem/server/scripts/"

# Install-time assets that live at the OEM/install root
cp install.bat nssm.exe RDPApps.reg "$DIST/oem/"

# Include the pinned CI-generated GPU acceleration bundle.
HELIOS_TMP="$DIST/helios.tmp"
mkdir -p "$HELIOS_TMP"
unzip -q "$HELIOS_BUNDLE" -d "$HELIOS_TMP"
HELIOS_INSTALL=$(find "$HELIOS_TMP" -type f -name Install-Helios.ps1 -print -quit)
[ -n "$HELIOS_INSTALL" ] || { echo "Install-Helios.ps1 was not found in $HELIOS_BUNDLE"; exit 1; }
cp -a "$(dirname "$HELIOS_INSTALL")" "$DIST/oem/helios"
rm -rf "$HELIOS_TMP"

# The update payload is what lands in C:\Program Files\WinBoat\server —
# the Guest Server Updater extracts it back into server\ on update. Built from an
# explicit directory so no source files or stale archives leak into the package.
( cd "$DIST/oem/server" && zip -r -q "../../update/winboat_guest_server.zip" . )

echo "Guest binaries built into guest_server/$DIST"
