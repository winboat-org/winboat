#!/bin/bash
set -e

echo "Building WinBoat guest binaries..."

# Variables
export GOOS=windows
export GOARCH=amd64
export VERSION="$(bun -p "require('./package.json').version")"
export COMMIT_HASH="$(git rev-parse --short HEAD)"
export BUILD_TIMESTAMP=$(date '+%Y-%m-%dT%H:%M:%S')
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

# The update payload is what lands in C:\Program Files\WinBoat\server —
# the Guest Server Updater extracts it back into server\ on update. Built from an
# explicit directory so no source files or stale archives leak into the package.
( cd "$DIST/oem/server" && zip -r -X -q "../../update/winboat_guest_server.zip" . )

echo "Guest binaries built into guest_server/$DIST"
