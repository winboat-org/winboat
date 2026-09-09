# Bundled FreeRDP

WinBoat uses its pinned WBFreeRDP client by default. A system FreeRDP installation
is not an installation prerequisite. Settings → FreeRDP → **Use system FreeRDP**
selects the first compatible FreeRDP 3 client found using the existing order:
`xfreerdp3`, `xfreerdp`, then `flatpak run --command=xfreerdp com.freerdp.FreeRDP`.
The setting defaults to off for both new and upgraded installations, persists in
`winboat.config.json`, and applies to new desktop, RemoteApp and shortcut launches.
If a selected system installation disappears, launches fall back to the bundle.
The settings refresh button detects clients installed while WinBoat is running.

## Development and packaging

`bun run dev` and `bun scripts/build.ts` automatically prepare the bundled client.
You can prepare it separately with `bun run prepare:freerdp`. The first preparation
downloads the pinned release in `scripts/freerdp-release.mjs`, verifies its archive
and executable SHA-256 hashes, and extracts it to `.cache/freerdp/linux-x64/wbfreerdp`.
Subsequent launches reuse the verified cache. To prepare without network access,
set `WINBOAT_FREERDP_ARCHIVE` to a local copy of the same release archive.

The main process supplies the runtime path. Development resolves it relative to
the compiled main entry point, independently of the working directory. Packaged
apps use `process.resourcesPath/freerdp/xfreerdp`; `extraResources` keeps the
executable outside `app.asar`. This covers mounted/extracted AppImage, DEB, RPM,
TAR.BZ2, the installed `winboat` binary and `linux-unpacked`. Keep the resource
directory with the application when moving an unpacked installation.

The electron-builder `beforePack` hook prepares the bundle even when the builder
is invoked directly. `afterPack` checks the copied executable, manifest and
notices, so packaging cannot silently produce an app without FreeRDP. Installed
apps never download the client at startup and do not need a system FreeRDP.
The existing WinBoat Electron and FreeRDP release bundles currently target Linux
x64; unsupported targets fail explicitly.

## Sources and host integration

The runtime directory includes original notices, a build manifest and `SOURCES.md`
linking to the matching source and relinking archives in the WBFreeRDP release.
The source bundle includes the Alpine sources and recipes for linked libraries.
The relinking kit contains the client objects/static libraries and instructions
for using modified libraries. Runtime execution does not enforce a release hash,
so installed copies remain replaceable with modified builds.

The client and codec libraries are static. X11/XWayland and audio services remain
host services. Optional hardware acceleration loads the host VA-API driver through
SoLo; the RX 6600/Mesa path is tested, while other drivers remain experimental.
Set `FREERDP_VAAPI_MODE=off` when launching WinBoat to force software decoding.
Smart cards, printing and FUSE file clipboard need their host services/devices.
See the WBFreeRDP release's validation report for the tested feature matrix.

## Checks

- `bun test tests/freerdp.test.ts tests/prepare-freerdp.test.ts`: default/override selection, detection order,
  fallback after removal, Flatpak arguments, development/package paths, archive
  integrity, cache repair, concurrent preparation and retry after failure.
- `bunx vue-tsc --noEmit --skipLibCheck -p src/renderer/tsconfig.json`
- `bunx tsc --noEmit -p src/main/tsconfig.json`
- `bun run build:linux-gs`: prepares and verifies the bundled runtime while building
  AppImage, DEB, RPM and TAR.BZ2, plus `dist/linux-unpacked`.

Validated locally on 2026-09-09 with release `winboat-3.30.0-1`: all 15 selection
and preparation tests passed. Development, mounted AppImage and the unpacked
executable passed the settings UI checks, including persisted selection and
missing-system-client detection. Each final AppImage, DEB, RPM and TAR.BZ2 was
extracted and its bundled executable's checksum, permissions, notices and startup
were verified. DEB/RPM metadata contains no FreeRDP dependency. A live connection
with WinBoat's TLS options passed playback, microphone and drive transfer checks.
