# WinBoat lean Electron fork

WinBoat uses a custom Electron 43.2.0 build for Linux x86-64 packages.
The fork removes browser features that WinBoat does not use.
It retains the trusted renderer, Node integration, DevTools, storage, networking, and accelerated rendering.

This document records the maintained configuration, final measurements, validation, and release process.
The tagged source remains the authority for implementation details.

## Published build

| Item                   | Value                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Repository             | [winboat-org/electron](https://github.com/winboat-org/electron)                               |
| Branch                 | `winboat-43.2.0`                                                                              |
| Immutable tag          | [`winboat-v43.2.0-1`](https://github.com/winboat-org/electron/releases/tag/winboat-v43.2.0-1) |
| Fork commit            | `c328b030fd3357139f66c8a3a84a4384c0136eed`                                                    |
| Upstream Electron base | `9b58e96340a34cccaccc08e410e76838b50b0cb2`                                                    |
| Chromium               | 150.0.7871.129                                                                                |
| Node.js                | 24.18.0                                                                                       |
| Build type             | Official release build with ThinLTO, PGO, and size optimization                               |

The release contains `electron-winboat-v43.2.0-1-linux-x64.zip`.

| Artifact            |              Size | SHA-256                                                            |
| ------------------- | ----------------: | ------------------------------------------------------------------ |
| Electron ZIP        | 104,350,649 bytes | `9163cb462555e606b025522a5f38e75cf78240435e00d3724742575147fd6245` |
| Electron executable | 165,784,824 bytes | `2aa1117c49640454a3f12792e977ee2149ead5a68eb9dabeff481f1734864d42` |

The senior review approved the corrected source and published artifact.

## Scope and constraints

- Optimize whole-process-tree PSS, not one process or summed RSS alone.
- Keep Node and native addon access in the trusted renderer.
- Keep the USB addon, Guest Server, Helios assets, and FreeRDP workflow.
- Keep DevTools, WebAssembly, HTTP/HTTPS, `fetch`, file URLs, WebSockets, and WebGL.
- Keep hardware GPU compositing, GPU rasterization, and a working SwiftShader fallback.
- Keep Chromium storage for `localStorage`, IndexedDB, cookies, and cache.
- Keep process sandboxing, the zygote model, HSTS, Safe Browsing, and BackupRefPtr.

## Fork changes

The complete GN configuration is
[`build/args/winboat.gn`](https://github.com/winboat-org/electron/blob/winboat-v43.2.0-1/build/args/winboat.gn).
The tagged repository also contains the Electron, Chromium, and Node patch series.

### Removed or reduced features

| Area             | Changes                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Build output     | Optimize for size, use relative vtables, and omit local debug symbols.                                 |
| Browser UI       | Remove PDF, printing, spellcheck, Electron extensions, plugins, and background mode.                   |
| Device and AI    | Remove JXL, browser speech, XR, BlueZ, WebNN backends, and the on-device-model service.                |
| Graphics         | Remove Dawn, WebGPU, and Chromium Vulkan. Keep ANGLE Vulkan only for SwiftShader.                      |
| Media            | Remove FFmpeg, browser audio, media remoting, HLS, hardware video, AV1, VPx, and OpenH264.             |
| WebRTC           | Remove bundled codecs, audio processing, SCTP, and native desktop-capture integrations.                |
| Network services | Remove Kerberos, mDNS, reporting, device-bound sessions, and the SQL disk-cache backend.               |
| Desktop services | Remove notifications, captive portal detection, translation, Compose, Lens, remoting, CUPS, and MPRIS. |
| Node.js          | Remove Amaro, `node:sqlite`, and Node experimental Web Storage.                                        |
| V8               | Remove Temporal support and reduce Maglev. Sparkplug, TurboFan, and WebAssembly remain.                |

Chromium SQLite remains enabled.
The `node_use_sqlite` option does not control renderer `localStorage` or IndexedDB.

### Required source work

Some disabled combinations needed source guards because upstream does not test them regularly.

- Electron now guards BlueZ setup, extension state, background mode, and FFmpeg packaging.
- Chromium now guards the optional on-device-model utility service and its Dawn dependency.
- Chromium supports Linux GPU builds without Chromium Vulkan or Dawn.
- The GPU patch preserves GPU rasterization through ANGLE/OpenGL.
- ANGLE retains its Vulkan backend only for the SwiftShader software path.
- Linux capture retains one small GPU-channel host required by unconditional references.
- Node removes disabled SQLite inspector code and Amaro metadata.
- Node constructs selected embedded metadata only when a process requests it.
- Node configuration queries the filtered Electron GN graph instead of unrelated Chromium targets.
- Desktop translation WebUI code keeps its operating-system and feature guards.

The GPU rasterization guard is important.
Removing Dawn initially made normal 2D rendering use software rasterization.
That regression added approximately 90 MiB of renderer-private memory on the Home screen.

### Deliberately retained

- DevTools frontend, inspector protocol, tracing, and required workers
- V8, Node.js, libuv, N-API, native modules, and ASAR support
- HTTP, HTTPS, DNS, TLS, `fetch`, WebSockets, and file URLs
- Chromium storage services and SQLite
- Skia, ANGLE/OpenGL, Ozone, Aura, X11, and Wayland
- GPU process isolation, hardware compositing, and GPU rasterization
- SwiftShader and the ANGLE backend that it requires
- Native dialogs, shell integration, clipboard, text shaping, and accessibility
- PNG, WebP, SVG, WOFF2, and other formats required by the interface
- HSTS, Safe Browsing, BackupRefPtr, and normal Chromium sandboxing

## Measured results

Linux measurements use `/proc/<pid>/smaps_rollup` for the browser and all descendants.
Each build uses the same application payload, screen, installation state, and settle time.
Runs use fresh Chromium profiles and alternate build order.

PSS is the primary physical-memory result.
Summed RSS counts shared mappings more than one time.
USS excludes shared pages and reports private memory.

### Stock Electron compared with the published fork

Both runtimes used the same WinBoat 1.0.6 application archive.
Its SHA-256 value was `d57f9bae4b07bc8591be60a15b29fa812aaaa6775e0f8a5c6494c01c2749220a`.

| Metric      | Stock Electron 43.2.0 | Published fork |                     Saving |
| ----------- | --------------------: | -------------: | -------------------------: |
| RSS, summed |             710.3 MiB |      603.2 MiB | 107.1 MiB, or 15.1 percent |
| PSS         |             357.2 MiB |      312.6 MiB |  44.6 MiB, or 12.5 percent |
| USS/private |             230.0 MiB |      211.0 MiB |   19.0 MiB, or 8.2 percent |

Mapping analysis attributes most PSS savings to executable and shared-library pages.
These pages consume physical memory but remain clean and reclaimable under pressure.
The private-memory reduction is smaller and is shown by USS.

### Electron disk size

The table compares the official and custom Electron 43.2.0 Linux x64 distributions.

| Scope            |             Stock |    Published fork |                            Saving |
| ---------------- | ----------------: | ----------------: | --------------------------------: |
| Distribution ZIP | 124,904,101 bytes | 104,350,649 bytes | 20,553,452 bytes, or 16.5 percent |
| Extracted files  | 326,181,148 bytes | 265,642,764 bytes | 60,538,384 bytes, or 18.6 percent |
| Main executable  | 219,917,560 bytes | 165,784,824 bytes | 54,132,736 bytes, or 24.6 percent |

### WinBoat package trimming

The published Electron ZIP remains a complete redistribution archive.
WinBoat removes more files when electron-builder creates the application package.

| Package change                                 |  Unpacked saving |
| ---------------------------------------------- | ---------------: |
| Keep only `en-US.pak`                          | 46,924,178 bytes |
| Remove the unused Crashpad handler             |  1,701,456 bytes |
| Compress Chromium notices with Brotli level 11 | 19,786,551 bytes |
| Total                                          | 68,412,185 bytes |

The package retains Chromium notices as `LICENSES.chromium.html.br`.
It also includes offline decompression instructions.

## Related WinBoat changes

Application work contributes additional RAM, startup, and disk savings.
These changes are separate from the matched Electron comparison above.

| Commit    | Change                                           | Primary effect                                                           |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `811d314` | Allowlist compiled application files.            | Reduced accidental package content and the application archive.          |
| `48a0945` | Load non-initial Vue routes dynamically.         | Defers route parsing and initialization.                                 |
| `e8a0f5a` | Replace ApexCharts with a small SVG gauge.       | Removes a large renderer runtime and reactive chart work.                |
| `1dff62c` | Remove `@electron/remote` and `electron-store`.  | Earlier combined tests measured approximately 20 MiB less memory.        |
| `3b4c1ea` | Clean up Apps-view subscriptions.                | Prevents stale listeners and component references.                       |
| `81316ef` | Prevent overlapping setup refreshes.             | Bounds concurrent polling work.                                          |
| `78b512b` | Run Chromium's network service in-process.       | Removes one utility process but moves its work into the browser process. |
| `39f232b` | Remove unused VueUse Motion and keep one locale. | Reduces renderer and package size.                                       |

The production `app.asar` decreased from approximately 454 MB to 51.6 MB.
Most of this reduction is a disk and startup improvement.

## Validation

The final tagged artifact passed these checks:

- Home and Setup rendered correctly.
- Home detected the existing WinBoat installation.
- The Guest API and container were online.
- Electron, Chromium, and Node reported the expected versions.
- The USB native addon loaded and enumerated devices.
- Guest Server, Helios, and data payloads remained present and unchanged.
- `localStorage`, IndexedDB, WebAssembly, and normal renderer DevTools worked.
- The embedded DevTools frontend loaded successfully.
- Hardware tests used ANGLE OpenGL and Skia GaneshGL.
- GPU compositing and GPU rasterization remained enabled.
- A forced SwiftShader launch used `ANGLE_SWIFTSHADER` successfully.
- The GPU process remained isolated.
- `ldd` reported no missing shared libraries.
- The package contained one locale, compressed notices, and no Crashpad or FFmpeg file.
- The application remained stable during the settled Home-screen test.

## WinBoat package integration

Linux x86-64 package builds use the published fork by default.

1. `scripts/prepare-electron.mjs` downloads or copies the pinned archive.
2. The script verifies the archive size and SHA-256 value.
3. `electron-builder.json` passes the verified ZIP through `electronDist`.
4. `scripts/after-pack.mjs` rejects other platforms and architectures.
5. The hook verifies the packaged executable against the published SHA-256 value.

The cache location is `.cache/electron`.
Set `WINBOAT_ELECTRON_ZIP` to use a verified local copy for offline builds.

Run the normal package command:

```bash
bun run build:linux-gs
```

Both GitHub Actions package jobs use this command.
Local and CI package builds therefore use the same verified Electron input.

Development mode keeps the stock Electron package.
The dependency remains pinned to 43.2.0 for API, type, Chromium, and Node ABI parity.

## Rebuild and release procedure

Use the tagged source and the
[fork build guide](https://github.com/winboat-org/electron/blob/winboat-v43.2.0-1/docs/development/winboat-lean-build.md).
The guide follows Electron's
[manual GN build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn).

From the synchronized Chromium source directory:

```bash
gn gen out/Lean \
  --args='import("//electron/build/args/winboat.gn")' \
  --root-target=//electron:electron_dist_zip

autoninja -C out/Lean electron:electron_dist_zip
```

For each new Electron version:

1. Rebase the fork onto the exact upstream release.
2. Refresh Electron, Chromium, and Node dependency patches.
3. Generate the filtered GN graph from `winboat.gn`.
4. Build `electron:electron_dist_zip` with release PGO and ThinLTO.
5. Test Home, Setup, storage, USB, DevTools, hardware GPU, and SwiftShader.
6. Compare matched whole-tree PSS against stock Electron.
7. Publish an immutable tag and release asset.
8. Update the pinned URL, size, and hashes in WinBoat.
9. Build WinBoat and verify its packaged executable hash.

## Current limits and future work

- The published fork supports Linux x86-64 only.
- Disabled feature combinations have less upstream build coverage.
- Every change requires compile, runtime, GPU, native-addon, and memory tests.
- `optimize_for_size` can change CPU behavior. Measure performance after compiler changes.
- Smaller Skia and GPU caches might save memory but can increase redraw and shader work.
- A Blink modules profile could remove unused generated bindings and initializers.
- Protected Audience is a good first Blink-profile candidate.
- WebRTC, page WebGL, Bluetooth, FIDO, payments, HID, and WebUSB remain size candidates.
- BackupRefPtr remains enabled because removing it has a memory-safety cost.
- Accessibility remains enabled because no measured saving justifies its removal.

Do not report executable size or process-count changes as direct RAM savings.
Use matched whole-tree PSS measurements for every future optimization claim.
