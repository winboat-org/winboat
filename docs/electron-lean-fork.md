# WinBoat lean Electron fork

This document records the WinBoat memory work. It also records the Electron 43.2.0 fork and its test results.

The document connects each optimization claim to a measurement. It also gives the information that is necessary to reproduce the work.

The maintained fork is public at [winboat-org/electron](https://github.com/winboat-org/electron).
Electron's patch system now records the Chromium and Node changes.
The remote checkout remains the build and research environment.

## Documentation language

This document follows ASD-STE100 Issue 9 where its rules apply to software documentation.

- Software identifiers and project names are technical nouns.
- Descriptive sentences contain a maximum of 25 words.
- Procedure sentences contain a maximum of 20 words.
- Each sentence has one topic.
- Procedures use the imperative form.
- The text uses active voice when the agent is known.
- The text does not use contractions or semicolons.

Reference: [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)

## Published source and reviewed artifact

| Item | Value |
| --- | --- |
| Repository | [winboat-org/electron](https://github.com/winboat-org/electron) |
| Branch | `winboat-43.2.0` |
| Immutable tag | `winboat-v43.2.0-1` |
| Release | [winboat-v43.2.0-1](https://github.com/winboat-org/electron/releases/tag/winboat-v43.2.0-1) |
| Electron fork commit | `c328b030fd3357139f66c8a3a84a4384c0136eed` |
| Chromium patch head | `d478fda33341005565f49c513361a409b56dc4f8` |
| Node patch head | `c9b806ac3f12bd47802104f3a98309bfdbaa8a46` |

The release contains `electron-winboat-v43.2.0-1-linux-x64.zip`.

| Artifact | Size | SHA-256 |
| --- | ---: | --- |
| Electron distribution ZIP | 104,350,649 bytes | `9163cb462555e606b025522a5f38e75cf78240435e00d3724742575147fd6245` |
| Electron executable | 165,784,824 bytes | `2aa1117c49640454a3f12792e977ee2149ead5a68eb9dabeff481f1734864d42` |

The final comparison used the same WinBoat 1.0.6 application archive in both runtimes.
Its SHA-256 value was `d57f9bae4b07bc8591be60a15b29fa812aaaa6775e0f8a5c6494c01c2749220a`.

| Metric | Stock Electron 43.2.0 | Published fork | Saving |
| --- | ---: | ---: | ---: |
| RSS, summed | 710.3 MiB | 603.2 MiB | 107.1 MiB, or 15.1 percent |
| PSS | 357.2 MiB | 312.6 MiB | 44.6 MiB, or 12.5 percent |
| USS/private | 230.0 MiB | 211.0 MiB | 19.0 MiB, or 8.2 percent |

These numbers isolate the Electron fork.
The separate WinBoat 1.0.5 to 1.0.6 comparison also includes application changes.

The senior review found that the first polished build packaged SwiftShader without its ANGLE backend.
The correction keeps ANGLE Vulkan only for the SwiftShader path.
Chromium Vulkan and Dawn remain disabled.

The final hardware test used ANGLE OpenGL, GaneshGL, and the AMD RX 6600.
The forced software test used `ANGLE_SWIFTSHADER`, GaneshGL, and the isolated GPU process.
Home, Setup, storage, WebAssembly, USB, DevTools, compositing, and rasterization passed.

The senior reviewer approved the corrected source and artifact for publication.

## WinBoat package integration

Linux x86-64 package builds now use the published fork by default.

`bun run build:linux-gs` runs `scripts/prepare-electron.mjs` before electron-builder.
The script downloads the immutable release asset and verifies its size and SHA-256 value.
It stores the verified archive in `.cache/electron`.

Set `WINBOAT_ELECTRON_ZIP` to use a verified local copy for an offline build.

`electron-builder.json` passes the verified ZIP as `electronDist`.
It also pins Electron 43.2.0.
The package command pins the Linux x86-64 architecture.

The `afterPack` hook verifies the packaged executable against the published executable SHA-256 value.
The build fails if electron-builder uses a different Electron executable.
The hook also rejects package targets other than Linux x86-64.

Development mode keeps the stock Electron package.
The dependency is pinned to 43.2.0 for matching APIs, types, Node ABI, and Chromium behavior.

Both GitHub Actions package jobs use `bun run build:linux-gs`.
Therefore, local and GitHub Actions package builds use the same verified Electron input.

The integration test produced an executable with the published SHA-256 value.
It also loaded the packaged USB native module with Electron 43.2.0.

The packaged Guest Server and data trees matched their source trees.
The package contained only `en-US.pak`, compressed Chromium notices, and no Crashpad or FFmpeg file.

## Goals and constraints

- Reduce real physical memory use, not merely package size or the number shown by one process.
- Keep WinBoat's Node integration. The renderer is trusted local application code and uses Node extensively.
- Keep DevTools, WebAssembly, HTTP/HTTPS and `fetch`, file URLs, WebSockets, WebGL, and normal hardware-accelerated compositing.
- Keep the USB native addon, Guest Server payload, Helios installation assets, and FreeRDP workflow working.
- Prefer PSS on Linux when comparing builds. Summed RSS double-counts shared pages, while USS excludes useful shared pages and can hide total physical cost.
- Compare the same WinBoat screen, installation state, settle time, Electron version, and Chromium profile conditions.

## Versions and build environment

| Component | Revision |
| --- | --- |
| Electron | 43.2.0, commit `9b58e96340a34cccaccc08e410e76838b50b0cb2` |
| Chromium | 150.0.7871.129 |
| Node.js | 24.18.0 |
| Target | Linux x86-64, official release build with ThinLTO and PGO |
| Published fork | `winboat-v43.2.0-1` |
| Remote checkout | `firstheberg2:/root/electron-lean/checkout/src` |
| GN output | `out/Lean` |

The checkout is shallow. The build used Electron's official manual GN workflow.

The workflow synchronized the Electron revision and DEPS. It generated the release graph and built the distribution target.

Reference: [Electron GN build instructions](https://www.electronjs.org/docs/latest/development/build-instructions-gn)

## WinBoat application changes

These changes are already committed on the `gpu-accel` branch. They are independent of the custom Electron fork.

| Commit | Change | Expected effect |
| --- | --- | --- |
| `811d314` | Allowlist only the compiled application files and make build failures propagate correctly. | Reduced `app.asar` from approximately 454 MB to 56.2 MB. This is primarily a disk and startup change. |
| `48a0945` | Convert non-initial Vue routes to dynamic imports | Avoids parsing and instantiating every view on startup. Makes route-specific code eligible for deferred loading and reclamation. |
| `e8a0f5a` | Replace ApexCharts with a small SVG `RadialGauge` component | Removed a large charting runtime and its reactive/rendering overhead from the Home screen. |
| `1dff62c` | Remove `@electron/remote` and `electron-store`. Use direct JSON for window state. | The combined change removed both dependency graphs. Earlier tests showed an approximately 20 MiB reduction. |
| `4671861` | Remove dependencies made unused by the earlier changes | Prevents dead packages from entering resolution and future package graphs. Mostly disk/startup hygiene after the runtime changes. |
| `3b4c1ea` | Clean up Apps-view event subscriptions and document the synchronous Vue watcher lifetime | Prevents duplicate/stale listeners and long-lived component references after route changes. |
| `81316ef` | Prevent overlapping setup memory-refresh operations | Bounds concurrent asynchronous polling work and avoids accumulating unresolved refreshes. |
| `78b512b` | Enable Chromium's `NetworkServiceInProcess2` feature. | Removes the network utility process. This change primarily changes process placement. Use whole-tree PSS to measure it. |
| `39f232b` | Remove unused VueUse Motion code and keep one production locale. | Reduces renderer code and package size. The locale change does not reduce idle PSS significantly. |

The uncommitted `src/renderer/lib/winboat.ts` polling-pool work is not part of this set. It needs behavioral tests before acceptance.

The test script `scripts/profile-memory.ts` is also not part of this set.

Commit `39f232b` removes `@vueuse/motion`. The renderer does not use its directives, components, or API.

A production renderer build passed. Its initial JavaScript chunk decreased from 820,649 bytes to 785,639 bytes.

A clean directory package decreased `app.asar` from 56,216,030 bytes to 51,591,876 bytes. The unpacked runtime decreased from 618 MB to 613 MB.

The removed packages include Motion, a duplicate VueUse 13 tree, Popmotion, Framesync, and optional Nuxt tools.

## Validated first-pass GN configuration

The maintained arguments are in `electron/build/args/winboat.gn`.
The active `out/Lean/args.gn` imports this file.

```gn
import("//electron/build/args/release.gn")

optimize_for_size = true
use_relative_vtables_abi = true
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0

enable_pdf_viewer = false
enable_pdf = false
enable_pdf_ink2 = false
enable_pdf_save_to_drive = false
enable_electron_extensions = false
enable_builtin_spellchecker = false
enable_printing = false
enable_plugins = false
enable_background_mode = false

enable_jxl_decoder = false
use_on_device_model_service = false
webnn_use_tflite = false
webnn_use_litert = false
enable_speech_service = false
enable_browser_speech_service = false
enable_vr = false
use_bluez = false
use_udev = false

use_dawn = false
skia_use_dawn = false
enable_vulkan = false
angle_enable_vulkan = true

use_vaapi = false
enable_gpu_channel_media_capture = false
chrome_wide_echo_cancellation_supported = false
proprietary_codecs = false
ffmpeg_branding = "Chromium"
enable_library_cdms = false
enable_media_remoting = false
enable_media_remoting_rpc = false
enable_hls_demuxer = false
enable_dav1d_decoder = false
enable_av1_decoder = false
enable_libaom = false
media_use_symphonia = false
media_use_libvpx = false
media_use_openh264 = false
use_alsa = false
use_pulseaudio = false

rtc_builtin_ssl_root_certificates = false
rtc_include_opus = false
rtc_exclude_audio_processing_module = true
rtc_include_builtin_audio_codecs = false
rtc_include_dav1d_in_internal_decoder_factory = false
rtc_enable_sctp = false
rtc_build_dcsctp = false
rtc_build_libvpx = false
rtc_build_opus = false
rtc_use_x11 = false
rtc_use_x11_extensions = false
rtc_use_pipewire = false
rtc_video_psnr = false

use_kerberos = false
enable_mdns = false
enable_reporting = false
enable_device_bound_sessions = false
enable_disk_cache_sql_backend = false
```

`use_on_device_model_service = false` does not remove all related code. Chromium links the service and its Dawn dependencies through the utility target.

The validated first-pass binary contains this code. The second-pass build adds the necessary source guard.

### Deliberately retained

- DevTools frontend and protocol
- V8, Node.js, and Node integration
- WebAssembly and its trap handlers
- HTTP/HTTPS, `fetch`, WebSockets, and the transport-security preload list
- File URLs and ASAR support
- WebGL, ANGLE's OpenGL backend, GPU compositing, and GPU rasterization
- SwiftShader/software GPU fallback
- Standard image formats needed by the UI
- Chromium accessibility support for now
- Cookies, storage, cache, service workers, and protocol APIs until usage and dependency seams are audited more deeply

## Required source patches

Several nominally supported GN combinations are not regularly built by Electron or Chromium. The fork needed small compile guards and dependency corrections.

### Chromium

| File | Reason |
| --- | --- |
| `gpu/command_buffer/service/shared_image/ozone_image_backing_factory.cc` | Do not dereference the Vulkan context provider when Vulkan is not compiled. Pass a null device queue to Ozone instead. |
| `gpu/ipc/service/gpu_init.cc` | Only declare Vulkan/Dawn filter state when either backend is compiled. |
| `media/capture/BUILD.gn` | Linux capture sources contain unconditional references to the lazy `VideoCaptureGpuChannelHost`. Keep that tiny implementation linked while the generated `ENABLE_GPU_CHANNEL_MEDIA_CAPTURE` feature remains zero. |
| `gpu/config/gpu_finch_features.cc` | Keep GPU rasterization enabled on Linux when Chromium Vulkan is absent. Preserve the default behavior when Chromium Vulkan is present. |

The last patch fixes the most important trap discovered during measurement. Upstream enables Linux GPU rasterization by default through `USE_WEBGPU_ON_VULKAN_VIA_GL_INTEROP`. Compiling Dawn out therefore changed ordinary 2D rendering to software rasterization. On WinBoat's Home screen that moved about 90 MiB into renderer-private native allocations. Enabling Linux GPU rasterization independently restored the intended ANGLE/OpenGL path without bringing WebGPU back.

### Electron

| File | Reason |
| --- | --- |
| `electron/buildflags/BUILD.gn` | Export an `ELECTRON_USE_BLUEZ` buildflag derived from Chromium's `use_bluez`. |
| `electron/shell/browser/electron_browser_main_parts.cc` | Guard BlueZ includes, initialization, and shutdown. |
| `electron/shell/browser/lib/power_observer_linux.cc` | Guard BlueZ setup while retaining systemd-logind suspend/resume observation. |
| `electron/shell/browser/api/electron_api_session.{h,cc}` | Remove the Session extensions property, member, and tracing when Electron extensions are disabled. |
| `electron/shell/browser/browser_process_impl.{h,cc}` | Guard background-mode overrides when background mode is disabled. |
| `electron/shell/browser/ui/webui/accessibility_ui.{h,cc}` | Register accessibility preferences through `PrefRegistrySimple`. Extensions and spellcheck pulled in the previous registry type. |

### Node integration build helper

`third_party/electron_node/tools/generate_config_gypi.py` passes these filters to `gn args`:

```text
--root-target=//electron:electron
--root-pattern=//electron:*
```

The fork intentionally generates a graph rooted at Electron rather than every Chromium test, tool, and Chrome target. Node's configuration helper also has to query that filtered graph or GN attempts to resolve targets that were intentionally excluded.

## Build and packaging procedure

The relevant remote environment is:

```bash
export PATH=/root/electron-lean/depot_tools:/root/electron-lean/checkout/src/third_party/node/linux/node-linux-x64/bin:$PATH
export CHROMIUM_BUILDTOOLS_PATH=/root/electron-lean/checkout/src/buildtools
cd /root/electron-lean/checkout/src
```

Generate the graph:

```bash
gn gen out/Lean \
  --args='import("//electron/build/args/winboat.gn")' \
  --root-target=//electron:electron_dist_zip
```

Build the official distribution target:

```bash
autoninja -C out/Lean electron:electron_dist_zip
```

The final corrected distribution is:

```text
/root/electron-lean/checkout/src/out/Lean/dist.zip
SHA-256: 1c64e36ddc1a19e1811a0d9e577c025116d874c4266fa5ca07c845a73bb575a7
```

The official ZIP contains Electron, not WinBoat. For local validation, its runtime was extracted and the following payloads were copied unchanged from the electron-builder output:

- `resources/app.asar`
- `resources/app.asar.unpacked`
- `resources/guest_server`
- `resources/data`

The assembled test runtime is `/tmp/winboat-electron-lean.t0mkof/runtime-raster`.

## Validation performed

- The distribution ZIP passed `unzip -t` and matched its remote SHA-256 after transfer.
- `app.asar` and the USB native binary matched the stock package byte-for-byte.
- The USB N-API addon loaded under Electron 43.2.0 and enumerated 14 local devices.
- Guest Server executable/update payloads and Helios installation assets remained present.
- Both stock and lean builds rendered the same isolated Setup welcome screen.
- Both builds detected the real `~/.local/share/winboat-app` installation and rendered the same Home dashboard with the Guest API online and container running.
- The corrected fork used ANGLE/OpenGL with Skia GaneshGL. GPU compositing and rasterization were enabled. WebGPU remained disabled.
- The embedded DevTools frontend was advertised by the runtime debugging endpoint and served successfully with HTTP 200.
- No required shared libraries were missing according to `ldd`.

## Memory measurement method

Linux measurements use `/proc/<pid>/smaps_rollup` for the browser process and every descendant. The profiler records:

- RSS is the resident page count for each process. Summed RSS counts shared mappings more than one time.
- PSS divides each shared page among its processes. PSS is the primary physical-memory metric for this work.
- USS contains private clean and private dirty pages. It helps identify process-private allocations.

The application is allowed to settle for 20 seconds. Each build gets a fresh Chromium `--user-data-dir`, while `XDG_DATA_HOME` remains unset for Home measurements so both use the same real WinBoat installation. Builds are alternated to reduce run-order and file-cache bias.

Do not leave `ELECTRON_RUN_AS_NODE=1` in the launch environment. The T3 Code host sets it for its own process tree, so probes explicitly remove it.

### Home-screen result

Three corrected runs per build:

| Metric | Stock Electron 43.2.0 | Lean Electron 43.2.0 | Difference |
| --- | ---: | ---: | ---: |
| RSS, summed | 704.1 MiB | 610.8 MiB | -93.3 MiB (-13.3%) |
| PSS | 346.6 MiB | 309.2 MiB | -37.4 MiB (-10.8%) |
| USS/private | 224.7 MiB | 209.1 MiB | -15.6 MiB (-6.9%) |

The final fork-side GPU patch was rebuilt without a command-line override. It used 612.5 MiB RSS, 309.3 MiB PSS, and 209.1 MiB USS.

This result agrees with the corrected three-run result.

Approximate average PSS savings by process group were:

| Process group | PSS saved |
| --- | ---: |
| Browser | 7.5 MiB |
| Three zygote entries | 12.5 MiB |
| GPU | 6.8 MiB |
| Renderer | 10.6 MiB |

### Follow-up matched memory audit

A later alternating audit reproduced the result. Each build had three runs.

Stock had medians of 348.1 MiB PSS and 226.8 MiB USS. Lean had 309.8 MiB PSS and 209.3 MiB USS.

The savings were 38.3 MiB PSS and 17.5 MiB private memory.

Classifying every `smaps` entry explains where the improvement came from:

| Mapping category | Stock PSS | Lean PSS | Difference |
| --- | ---: | ---: | ---: |
| Electron executable | 157.6 MiB | 128.1 MiB | -29.5 MiB |
| Anonymous heap/maps | 130.7 MiB | 127.2 MiB | -3.5 MiB |
| Shared libraries | 45.6 MiB | 38.0 MiB | -7.6 MiB |
| Electron resources | 3.3 MiB | 2.9 MiB | -0.4 MiB |

Most first-pass PSS savings are therefore resident executable and library pages. These are real physical pages and legitimate PSS savings, but they are clean and reclaimable under pressure. The anonymous/private reduction is smaller. Summed RSS overstates the result because it counts the same executable pages in multiple processes.

Raw follow-up results are preserved locally at:

- `/tmp/winboat-memory-ab-home.json`
- `/tmp/winboat-stock-lean-final-smaps.json`
- `/tmp/winboat-lean-flag-matrix.json`

### Runtime flag experiments

The following experiments used the lean build, the real Home route, and validation of GPU compositing, GPU rasterization, WebGL, and WebAssembly:

| Experiment | PSS effect | USS effect | Decision |
| --- | ---: | ---: | --- |
| `--in-process-gpu` | Approximately -10.3 MiB | Neutral to slightly higher | Keep as an opt-in experiment. It removes GPU-process isolation and GPU crash recovery and needs broad GPU/Wayland testing. |
| `--no-sandbox --no-zygote` | -6.1 MiB | +5.9 MiB | Reject. It mostly moves code/COW cost into child processes while weakening isolation. |
| Both flags | -19.7 MiB | -1.1 MiB | Reject as a default. Most additional savings are file-backed. The security and reliability costs increase. |
| `--single-process --no-sandbox` | Did not launch | Did not launch | Reject. This Electron and Node configuration traps immediately. |
| `--js-flags=--no-maglev` | No repeatable idle saving | No repeatable idle saving | Runtime disabling is not a RAM optimization. Compile-time removal remains a binary-size candidate. |
| `--js-flags=--lite-mode` | -12.6 MiB | -11.5 MiB | Reject. This V8 build loses WebAssembly and some inspector coverage. |

### Disk result

| Artifact | Stock | Lean |
| --- | ---: | ---: |
| Main executable | 219.9 MB | 177.8 MB |
| Assembled WinBoat runtime | 618 MB | 571 MB |

The executable is 42.2 MB smaller. The assembled runtime is about 47 MB smaller. These are disk results and must not be presented as RAM savings.

## Validated second-pass build

The second-pass build passed package, launch, route, storage, GPU, and matched memory tests.

GN generated 29,913 targets from 4,552 files. The build uses the existing `out/Lean` object cache.

The second pass adds these GN arguments:

```gn
enable_background_contents = false
enable_message_center = false
enable_chrome_notifications = false
enable_captive_portal_detection = false
enable_compute_pressure = false
enable_compose = false
enable_lens_desktop = false
enable_on_device_translation = false
enable_paint_preview = false
enable_session_service = false
enable_memory_coordinator_internals = false
enable_bound_session_credentials = false
enable_remoting = false
use_cups = false
use_cups_ipp = false
use_mpris = false
enable_webui_certificate_viewer = false

node_use_amaro = false
node_use_sqlite = false
media_use_ffmpeg = false

v8_enable_temporal_support = false
v8_enable_maglev = false

rtc_build_examples = false
rtc_build_tools = false
```

Safe Browsing keeps its default mode. DevTools, HSTS, BackupRefPtr, WebSockets, and GPU process isolation also remain enabled.

The build keeps Chromium SQLite. Chromium uses its storage service for `window.localStorage` and IndexedDB.

The `node_use_sqlite` argument only controls Node SQLite. It removes `node:sqlite` and Node experimental Web Storage.

### Second-pass source changes

| File | Change |
| --- | --- |
| `content/utility/BUILD.gn` | Guard the on-device-model service dependency with `USE_ON_DEVICE_MODEL_SERVICE`. |
| `content/utility/utility_main.cc` | Guard the related include, sandbox case, and service factory. |
| `content/utility/services.cc` | Guard the on-device-model service registration. |
| `electron/BUILD.gn` | Guard FFmpeg runtime paths and distribution files with `media_use_ffmpeg`. |
| `third_party/electron_node/tools/generate_config_gypi.py` | Query the Electron graph and remove disabled Amaro from Node runtime metadata. |
| `third_party/electron_node/tools/js2c.cc` | Construct the Node built-in source map on its first use. |
| `third_party/electron_node/src/node_snapshotable.cc` | Construct Node snapshot metadata on its first use. |
| `third_party/electron_node/src/node_metadata.cc` | Include the Node QUIC guard independently of SQLite. |
| `third_party/electron_node/node.gni` | Remove the Amaro source from the shareable built-in list when Amaro is disabled. |
| `third_party/electron_node/unofficial.gni` | Remove the Node Inspector DOM Storage agent when Node SQLite is disabled. |
| `third_party/electron_node/src/inspector_agent.cc` | Guard Node DOM Storage agent references with `HAVE_SQLITE`. |

The two lazy Node changes prevent global construction in processes that do not use Node metadata. The expected RAM reduction is small.

The Node DOM Storage guard does not change Chromium renderer storage. Normal renderer DevTools storage inspection also remains available.

### Graph checks

The generated graph has no non-data path to these targets:

- Dawn native
- FFmpeg
- The on-device-model service
- Node SQLite

Some Dawn headers remain in the graph. These headers do not add the Dawn native implementation to the executable.

### Build failures and corrections

Ninja kept all compatible objects after each correction. No correction used a clean build.

| Failure | Cause | Correction |
| --- | --- | --- |
| Blink could not find `rtc_base/socket_address.h`. | `is_p2p_enabled = false` removed an include path that Blink media-stream code still needs. | Restore P2P support. Do not use this argument in the current fork. |
| `generate_config_gypi.py` could not find `gn`. | A resumed SSH shell did not contain `depot_tools` in `PATH`. | Export the documented build environment before each Ninja command. |
| `node_metadata.cc` could not find `openssl/quic.h`. | Node received its QUIC compatibility guard indirectly through SQLite. | Include `quic/guard.h` independently of SQLite. |
| Node Inspector files could not find `sqlite3.h`. | The GN build kept the experimental Node DOM Storage agent without Node Web Storage. | Remove that agent from the no-SQLite graph and guard its references. |
| The final binary still contained the 3,741,294-byte Amaro source. | Electron always added Amaro to the shareable built-in list. | Remove Amaro from this list when `node_use_amaro` is false. |
| Node metadata still advertised Amaro after source removal. | GN reported the declared list instead of the filtered build list. | Apply the same Amaro filter in `generate_config_gypi.py`. |

The corrected `node_metadata.cc` and `inspector_agent.cc` files compile.

### Pre-Amaro correction package

The first second-pass package completed before the Amaro list correction. It has these properties:

| Item | Result |
| --- | --- |
| ZIP size | 104,717,305 bytes |
| ZIP SHA-256 | `7d15f961f61946a2f8a870a4f505e48056c80f6fa5f94ecebc80cf13cfbcbf84` |
| Stripped executable size | 169,221,368 bytes |
| First-pass executable size | 177,757,432 bytes |
| Executable reduction | 8,536,064 bytes |
| Electron version | `v43.2.0` |
| Missing shared libraries | None |
| FFmpeg dependency or ZIP file | None |
| DevTools endpoint | Advertised and served with HTTP 200 |

The ZIP passed its integrity test. The symbol scan found no V8 Temporal, Node SQLite, or Node Web Storage symbols.

The scan also found no Dawn native, Tint, or SPIR-V Tools symbols. These results validate the related dependency guards.

The scan found 5,732 Maglev symbols. Their named size was 1,825,197 bytes.

Thus, `v8_enable_maglev = false` does not remove all Maglev code. Treat this option as a partial size change.

The generated Node source in this package contained the full Amaro input. A later package corrects this problem.

### Pre-publication second-pass package

This package includes the Amaro source and metadata corrections.

| Item | Result |
| --- | --- |
| ZIP size | 103,355,198 bytes |
| ZIP SHA-256 | `224dfd2ec360b2daed1e192d2fa7a15d0d892ba2f6d1f3b4f3c644c63764aaf0` |
| Stripped executable size | 165,477,624 bytes |
| First-pass executable size | 177,757,432 bytes |
| Executable reduction | 12,279,808 bytes, or 6.9 percent |
| First-pass ZIP size | 109,026,932 bytes |
| ZIP reduction | 5,671,734 bytes, or 5.2 percent |
| Extracted Electron runtime | 252 MB |

The ZIP passed its integrity test. Electron reports version `v43.2.0`.

The published artifact supersedes this package.
Its reviewed size and SHA-256 values are in the published-source section.

All shared libraries resolve. The package and the dynamic dependency list do not contain FFmpeg.

DevTools advertises its frontend. The remote DevTools frontend returns HTTP status 200.

Node runtime metadata reports `node_use_amaro` as false. Its shareable list contains only Undici.

`process.versions.amaro` is absent. The `node:sqlite` module is absent. WebAssembly remains available.

The final generated Node source does not contain the Amaro raw resource.

The final symbol scan has these results:

| Symbol family | Symbol count | Named size |
| --- | ---: | ---: |
| V8 Temporal | 0 | 0 bytes |
| Node SQLite | 0 | 0 bytes |
| Node Web Storage | 0 | 0 bytes |
| Dawn native | 0 | 0 bytes |
| Tint | 0 | 0 bytes |
| SPIR-V Tools | 0 | 0 bytes |
| V8 Maglev | 5,732 | 1,825,197 bytes |

These checks validate static removal. The tests below validate the WinBoat runtime behavior and memory result.

### Second-pass matched memory result

The audit compared stock, first-pass, and second-pass Electron runtimes. Each runtime used the same WinBoat application payload.

All three `app.asar` files had this SHA-256 value:

```text
ce7a7b1336a475002579e40fdf83ff3782edc363abd21f247e1295b3e0140be2
```

The audit used this balanced order:

```text
stock, first pass, second pass
second pass, stock, first pass
first pass, second pass, stock
```

Each run used a fresh Chromium data directory. Each run settled for 20 seconds before the memory sample.

The audit kept `XDG_DATA_HOME` unset. All nine runs detected the real WinBoat installation and opened the Home route.

All nine runs showed Windows 11 Pro. The Guest API was online in all nine runs.

The table contains the median of three runs for each build:

| Metric | Stock | First pass | Second pass | Second versus stock | Second versus first |
| --- | ---: | ---: | ---: | ---: | ---: |
| RSS, summed | 709.7 MiB | 613.9 MiB | 604.8 MiB | -104.9 MiB (-14.8%) | -9.2 MiB (-1.5%) |
| PSS | 353.2 MiB | 315.6 MiB | 309.0 MiB | -44.2 MiB (-12.5%) | -6.5 MiB (-2.1%) |
| USS/private | 225.0 MiB | 211.2 MiB | 208.2 MiB | -16.8 MiB (-7.5%) | -3.0 MiB (-1.4%) |

The second pass gives another 6.5 MiB PSS reduction. It also makes the executable 12,279,808 bytes smaller.

Executable size and PSS are separate results. The mapping audit shows how the second-pass PSS changed:

| Mapping category | First-pass PSS | Second-pass PSS | Difference |
| --- | ---: | ---: | ---: |
| Electron executable | 130.4 MiB | 127.5 MiB | -2.9 MiB |
| Anonymous heap and maps | 126.3 MiB | 124.8 MiB | -1.6 MiB |
| Shared libraries | 42.3 MiB | 41.5 MiB | -0.8 MiB |
| FFmpeg shared library | 1.0 MiB | 0 MiB | -1.0 MiB |
| Other files | 3.6 MiB | 3.6 MiB | -0.1 MiB |

The category medians do not add exactly to the total median. Different runs can supply the median for each category.

The browser saved approximately 2.1 MiB PSS. The renderer saved approximately 1.8 MiB PSS.

The three zygote entries saved approximately 0.9 MiB PSS. The GPU process saved approximately 0.6 MiB PSS.

The audit performed capability probes after each memory sample. Thus, the storage and GPU probes did not increase the recorded sample.

`window.localStorage` and IndexedDB passed in all nine runs. Chromium SQLite therefore remains functional without Node SQLite.

WebAssembly passed in all nine runs. The Electron, Chromium, and Node versions matched in all nine runs.

All runs used isolated GPU processes. They used ANGLE OpenGL and Skia GaneshGL with hardware GPU compositing and rasterization.

The raw result is preserved locally at `/tmp/winboat-memory-secondpass.json`.

### Second-pass selection record

| Candidate | Current status | Expected primary effect |
| --- | --- | --- |
| Guard the on-device-model utility service | Applied in the build. | Remove Dawn native, Tint, and SPIR-V code. |
| Disable FFmpeg | Applied with Electron package guards. | Remove the FFmpeg shared library and integration code. |
| Disable Node Amaro | Applied and validated in the final package. | Removed the 3,741,294-byte embedded TypeScript transformer. |
| Disable Node SQLite | Applied with Node build corrections. | Remove approximately 0.8 to 1.1 MB of linked Node code. |
| Disable V8 Temporal | Applied in the build. | Remove proposal code and reduce the graph. |
| Disable V8 Maglev | Applied, but 1,825,197 named bytes remain. | Partial code reduction. CPU tests are required. |
| Disable translation and Compute Pressure | Applied in the build. | Reduce service, Mojom, Blink, and generated binding code. |
| Disable unused desktop services | Applied in the build. | Reduce executable code and the build graph. |
| Disable P2P | Rejected after a compile failure. | No saving in the current build. |
| Disable Safe Browsing | Deferred because of broad build coupling and security effects. | No saving in the current build. |

The final test confirmed GPU compositing and GPU rasterization.

### Source-level RAM candidates

| Candidate | Why it may affect live memory | Qualification |
| --- | --- | --- |
| Lower Skia/GPU cache caps | Chromium permits a 32 MiB Skia cache per process and a 6 MiB GPU program cache. | Test after a warmed route sweep. Small caches can cause redraw or shader compilation delays. |
| Lazily build Node's built-in source map and embedded snapshot metadata | Generated Node code runs large global constructors before the executable knows whether it is a browser, renderer, GPU, or zygote process. The built-in map contains 384 entries and is currently constructed in every process. | Preserve Node in the browser and renderer while moving generated globals to function-local statics. Expected to save private heap in non-Node processes, but likely hundreds of KiB rather than tens of MiB. |
| Lazily register Chrome color mixers | Electron installs approximately 1,347 Chrome color recipes. A native window makes these recipes live. | Keep core UI and GTK colors. Register Chrome mixers when DevTools requests them. Test all native UI and theme changes. |
| Disable BackupRefPtr implementation | BRP can add allocator metadata, quarantine behavior, and fragmentation. A GN graph succeeds without it. | This change has a memory-safety cost. Isolate and measure it separately. |

### Larger custom-profile work

The current executable still contains lower-bound named code for several entirely unused web-platform surfaces:

| Surface | Named linked code |
| --- | ---: |
| WebRTC | 4.38 MB |
| Protected Audience/ad auction | 1.71 MB |
| WebGL page API | 1.43 MB |
| Bluetooth | 0.58 MB |
| FIDO/authenticator | 0.39 MB |
| Payments | 0.39 MB |
| WebNN | 0.32 MB |
| HID | 0.24 MB |
| WebUSB | 0.16 MB |
| Serial, Gamepad, geolocation, and MIDI combined | About 0.42 MB |

The long-term goal is a WinBoat-specific Blink modules profile. Blink currently pulls most web platform modules into Electron.

Target removal is not sufficient. The profile must also filter IDL inputs, generated V8 bindings, and module initializer registrations.

The profile can remove the unused surfaces in the table. It can also remove other audited web platform surfaces.

Generated bindings install prototypes when V8 creates a context. DevTools uses more Blink functions than WinBoat.

ANGLE/OpenGL must remain for compositing. This requirement applies if a later build removes the page WebGL API.

Build small capability groups. Use compile-time flags for each group. Do not maintain one large deletion patch.

Protected Audience is a good first prototype. WinBoat does not use the advertising auction stack.

Named linked code uses approximately 1.71 MB. ThinLTO auction-worklet input uses 5.97 MB. Chromium does not provide a sufficient top-level switch.

### Package-size candidates

- The validated Linux runtime has 55 locale files. Their total size is 47,472,269 bytes.
- The production configuration now keeps only `en-US.pak`. This file is 548,091 bytes in the custom runtime.
- This rule removes 46,924,178 bytes from the unpacked custom runtime.
- The main process sets Chromium's application language to `en-US` before Electron becomes ready.
- A test used `LANG=de_DE.UTF-8` and a package with only `en-US.pak`.
- The test opened Home and reported `en-US` through `navigator.language` and `Intl`.
- The `afterPack` hook removes `chrome_crashpad_handler` on Linux and Windows. WinBoat does not start Electron `crashReporter`.
- This rule removes another 1,701,456 bytes from the unpacked custom Linux runtime.
- The package keeps Chromium's notices as `LICENSES.chromium.html.br`. Chromium and Electron licenses require notices with binary distributions.
- The build uses Brotli level 11 and the maximum standard window size.
- Compression reduces the 19,956,019-byte notice file to 169,281 bytes.
- The package includes a 187-byte text file with offline decompression instructions.
- A decompression test reproduced the source file's SHA-256 value exactly.
- The compressed notice reduces the unpacked runtime by another 19,786,551 bytes.
- The locale, Crashpad, and notice changes remove 68,412,185 bytes from the unpacked custom runtime.
- A future offline license viewer can open the compressed notice directly.
- An electron-builder directory test used the pre-publication second-pass Electron ZIP and the current application build.
- The unpacked result was 510,979,675 bytes. `du -sh` reported 488 MiB.
- The packaged executable matched the second-pass executable SHA-256 value.
- The test package contained one locale, compressed notices, and no Crashpad handler.
- SwiftShader is several megabytes and contributes essentially no idle PSS on a working hardware GPU. The published fork keeps its required ANGLE Vulkan backend.
- Unused internal WebUI resources can be filtered while retaining the approximately 4.3 MB DevTools frontend. This is package/resource work, not a large RAM optimization.

### WinBoat 0.9.0 size comparison

The published 0.9.0 unpacked ZIP contains 380,911,852 uncompressed bytes.

The current lean 1.0.6 runtime contains 510,979,896 bytes. The net increase is 130,068,044 bytes.

GitHub Actions did not create the difference. The application payload changed substantially after 0.9.0.

| Component | WinBoat 0.9.0 | WinBoat 1.0.6 | Change |
| --- | ---: | ---: | ---: |
| Electron executable | 196,249,160 bytes | 165,477,624 bytes | -30,771,536 bytes |
| Application archive | 68,895,430 bytes | 51,591,986 bytes | -17,303,444 bytes |
| Unpacked application files | 7,997,586 bytes | 7,076,945 bytes | -920,641 bytes |
| Guest Server payload | 15,639,278 bytes | 256,498,266 bytes | +240,858,988 bytes |
| Locales | 43,062,448 bytes | 548,091 bytes | -42,514,357 bytes |
| Chromium notices | 12,278,238 bytes | 169,468 bytes | -12,108,770 bytes |
| Crashpad | 1,353,040 bytes | 0 bytes | -1,353,040 bytes |

The new Guest Server payload adds 240,858,988 bytes. All other changes remove 110,790,944 bytes.

Thus, Helios and the new Guest Server model cause the complete net increase.

The current Helios tree contains 231,060,159 bytes. Its largest sections are Mesa, OpenCL, drivers, and prerequisites.

The Helios tree includes approximately 43.8 MB of PDB files. Confirm their support purpose before release packaging.

The old release used Electron 35.7.5. Its executable was larger than the current lean Electron executable.

The published compressed artifacts have these sizes:

| Artifact | WinBoat 0.9.0 | WinBoat 1.0.6 lean | Change |
| --- | ---: | ---: | ---: |
| AppImage | 147,638,646 bytes | 214,205,690 bytes | +66,567,044 bytes |
| Debian package | 100,672,402 bytes | 171,219,408 bytes | +70,547,006 bytes |
| Valid RPM | 100,276,177 bytes | 149,641,570 bytes | +49,365,393 bytes |
| Tar archive | 140,271,847 bytes | 192,431,932 bytes | +52,160,085 bytes |

The old tar archive used gzip. The new tar archive uses bzip2, so that row is not an equal codec comparison.

Before the integration, the GitHub Actions workflow did not select the custom Electron distribution.

A clean runner therefore downloaded stock Electron 43.2.0. The release would have lost the fork's size and RAM improvements.

An isolated Actions-equivalent package test confirmed this behavior:

| Output | Actions-equivalent stock Electron | Local lean Electron | Lean saving |
| --- | ---: | ---: | ---: |
| Unpacked runtime | 572,763,153 bytes | 510,979,896 bytes | 61,783,257 bytes |
| AppImage | 235,539,791 bytes | 214,205,690 bytes | 21,334,101 bytes |
| Debian package | 188,289,836 bytes | 171,219,408 bytes | 17,070,428 bytes |
| Bzip2 tar archive | 214,225,041 bytes | 192,431,932 bytes | 21,793,109 bytes |

The Actions workflow also sets `ELECTRON_BUILDER_COMPRESSION_LEVEL=5`. Local archive creation used the default level 9.

The lower level applies to archive creation. It prioritizes build speed over the smallest tar archive.

The integration now makes the custom Electron ZIP a versioned CI input.
It verifies the SHA-256 value before electron-builder starts.

The configuration passes the verified path as `electronDist`.
The `afterPack` hook validates the packaged executable hash.

### Pre-publication WinBoat 1.0.6 artifact audit

The audit used the output from `bun run build:linux-gs` with version 1.0.6.

The unpacked runtime contains 510,979,896 bytes. Its executable contains 165,477,624 bytes.

The executable SHA-256 value is:

```text
013c5b905ba22d2e55dce3eaa8f04f29dd710daa623e254b8c6e94423ec780c1
```

This value matches the final second-pass Electron executable.

| Artifact | Size | Payload result |
| --- | ---: | --- |
| AppImage | 214,205,690 bytes | Passed the complete application-tree comparison. |
| Debian package | 171,219,408 bytes | Passed the complete application-tree comparison. |
| Bzip2 tar archive | 192,431,932 bytes | Passed the complete application-tree comparison. |
| Original RPM | 48,402,432 bytes | Failed. The compressed payload ends before the WinBoat executable. |
| Isolated replacement RPM | 149,641,570 bytes | Passed complete decompression and the application-tree comparison. |

The AppImage and tar archive do not contain the managed-package AppArmor profile. This difference is intentional.

The original RPM header describes the complete 510,985,542-byte installed package. Its header digests also pass.

However, `rpm2cpio` reports a payload read error. Extraction stops during a Helios library.

The incomplete payload omits later Helios files, Guest Server files, snapshots, and the WinBoat executable.

Two isolated RPM builds produced complete 149,641,570-byte packages. One build used `/tmp` for temporary files.

A later Actions-equivalent build failed in FPM with `Errno::EDQUOT`. The failure occurred while FPM copied the RPM staging tree.

The `/tmp` filesystem had free space. However, the user had nearly reached its 25,683 MB temporary-storage quota.

Temporary-storage quota exhaustion is therefore the probable cause of the original truncated RPM.

Check `quota -s` before large package builds. The `df` command does not show this user quota.

Do not distribute the original 48,402,432-byte RPM.

Read every RPM payload before release:

```bash
rpm2cpio dist/winboat-1.0.6-x86_64.rpm >/dev/null
```

The command must return status zero. A header-only `rpm -K` check is insufficient.

The 1.0.6 package audit also confirmed these items:

- The application archive contains only the selected production roots.
- The 39 compiled application files match the current build output.
- Guest Server and `data` match their source payloads byte-for-byte.
- The Guest Server update ZIP passes its integrity test.
- Helios contains its manifest, drivers, libraries, and installation files.
- The USB native addon loads and enumerates 14 devices.
- The package contains only `en-US.pak`.
- The package does not contain Crashpad or FFmpeg.
- The Brotli notice expands to the original Chromium notice file.
- `ldd` reports no missing shared libraries.

The packaged application remained stable during a 25-second Home-screen test. It did not restart.

The test reported Electron 43.2.0, Chromium 150.0.7871.129, and Node 24.18.0.

The Home screen detected the existing installation. The Guest API and container were online.

Local storage, IndexedDB, WebAssembly, USB, and DevTools passed their runtime checks.

The GPU process remained isolated. ANGLE OpenGL, GaneshGL, GPU compositing, and GPU rasterization were enabled.

WebGPU, Node SQLite, and Amaro remained absent as intended.

### WinBoat 1.0.6 matched stock comparison

The audit compared official Electron 43.2.0 with the final second-pass fork.

Both runtimes used the same 1.0.6 application archive. Its SHA-256 value was:

```text
d57f9bae4b07bc8591be60a15b29fa812aaaa6775e0f8a5c6494c01c2749220a
```

The audit used this balanced order:

```text
stock, lean, lean, stock, stock, lean
```

Each run used a fresh Chromium data directory. Each run used the real WinBoat installation data.

The audit waited for the validated Home screen. It then allowed a 20-second settle period before the memory sample.

The table contains the median of three runs for each build:

| Metric | Stock | Lean | Saving |
| --- | ---: | ---: | ---: |
| RSS, summed | 708.8 MiB | 605.4 MiB | 103.4 MiB, or 14.6 percent |
| PSS | 354.7 MiB | 310.6 MiB | 44.1 MiB, or 12.4 percent |
| USS/private | 230.9 MiB | 209.2 MiB | 21.7 MiB, or 9.4 percent |

The fresh PSS result reproduces the earlier 44.2 MiB result.

All six runs reported Electron 43.2.0, Chromium 150.0.7871.129, and Node 24.18.0.

All six runs opened Home with the Guest API online and the container running.

Local storage, IndexedDB, WebAssembly, and the `en-US` locale passed in all runs.

Each run used six processes. The process tree contained the browser, three zygotes, one GPU process, and one renderer.

Both builds used ANGLE OpenGL and GaneshGL. GPU compositing, GPU rasterization, and WebGL remained enabled.

The lean build kept WebGPU disabled. The stock build kept its default WebGPU support.

The disk comparison gave these results:

| Scope | Stock | Lean | Saving |
| --- | ---: | ---: | ---: |
| Main executable | 219,917,560 bytes | 165,477,624 bytes | 54,439,936 bytes, or 24.8 percent |
| Electron distribution | 326,181,148 bytes | 263,494,140 bytes | 62,687,008 bytes, or 19.2 percent |
| Runtime with equal application payload | 642,078,864 bytes | 510,979,896 bytes | 131,098,968 bytes, or 20.4 percent |

The distribution row measures the fork before the package-time file trimming.

The equal-payload row also includes locale, Crashpad, and Chromium notice trimming.

The raw memory result is `/tmp/winboat-memory-stock-vs-lean-1.0.6.json`.

### Corrected WinBoat 1.0.5 to 1.0.6 comparison

The previous 1.0.5 package contained files that were not part of the application. That package gives an unfair baseline for optimization claims.

The corrected baseline uses commit `811d314`. This commit has version 1.0.5 and the production file allowlist. It excludes Git data, source files, tests, temporary files, and development files from the application archive.

The baseline does not include later 1.0.6 application changes. It still uses ApexCharts, `electron-store`, `@electron/remote`, eager routes, and the other 1.0.5 application code. These later application changes are valid 1.0.6 improvements.

The baseline uses stock Electron 43.2.0. It keeps all stock locales, Crashpad, FFmpeg, and the uncompressed Chromium notice. It does not use the custom Electron fork or the 1.0.6 `afterPack` step.

The build produced only the unpacked Linux directory and an AppImage. It did not produce DEB, RPM, or tar packages.

The corrected application archive has 5,837 entries. Its roots are `main`, `renderer`, `node_modules`, and `package.json`.

The corrected AppImage SHA-256 value is:

```text
d87b2052afbc4ed0bd824895a75feae8261dd645c0157e8e466e5744ca1f45e6
```

The audit used this balanced order:

```text
1.0.5 corrected, 1.0.6, 1.0.6, 1.0.5 corrected, 1.0.5 corrected,
1.0.6, 1.0.6, 1.0.5 corrected, 1.0.5 corrected, 1.0.6
```

Each run used a fresh Chromium data directory. Each run used the real WinBoat installation data.

The audit waited for the validated Home screen. It then allowed a 20-second settle period before the memory sample.

The table contains the median of five runs for each version:

| Metric | Corrected WinBoat 1.0.5 | WinBoat 1.0.6 | Saving |
| --- | ---: | ---: | ---: |
| RSS, summed | 835.6 MiB | 618.1 MiB | 217.5 MiB, or 26.0 percent |
| PSS | 402.9 MiB | 315.6 MiB | 87.3 MiB, or 21.7 percent |
| USS/private | 273.8 MiB | 219.6 MiB | 54.1 MiB, or 19.8 percent |

PSS is the primary physical-memory result. Summed RSS counts shared pages more than one time.

The process-group PSS medians were:

| Process group | Corrected WinBoat 1.0.5 | WinBoat 1.0.6 | Change |
| --- | ---: | ---: | ---: |
| Browser | 125.3 MiB | 110.8 MiB | -14.5 MiB |
| Three zygote entries | 30.8 MiB | 20.0 MiB | -10.8 MiB |
| GPU | 77.5 MiB | 70.1 MiB | -7.4 MiB |
| Renderer | 141.8 MiB | 116.4 MiB | -25.4 MiB |
| Network utility | 28.6 MiB | No separate process | Process moved in-process |

Independent group medians do not add exactly to the total median.

WinBoat 1.0.5 used seven processes. WinBoat 1.0.6 used six processes.

The 1.0.6 main process hosts the network service. Thus, the removed utility-process value is not a pure saving.

The fair package-size comparison is:

| Scope | Corrected WinBoat 1.0.5 | WinBoat 1.0.6 | Saving |
| --- | ---: | ---: | ---: |
| AppImage | 255,738,496 bytes | 214,205,690 bytes | 41,532,806 bytes, or 16.2 percent |
| Unpacked runtime | 661,846,121 bytes | 510,979,896 bytes | 150,866,225 bytes, or 22.8 percent |
| Application archive | 71,470,486 bytes | 51,591,986 bytes | 19,878,500 bytes, or 27.8 percent |
| Electron executable | 219,917,560 bytes | 165,477,624 bytes | 54,439,936 bytes, or 24.8 percent |

This comparison includes valid application, package, process-layout, and Electron fork changes. The matched stock comparison above isolates the Electron fork with an equal 1.0.6 application payload.

All ten runs opened Home with the Guest API online and the container running.

The raw result is `/tmp/winboat-memory-corrected-1.0.5-vs-1.0.6.json`.

### Original packaged WinBoat 1.0.5 to 1.0.6 comparison

This audit compared the actual local 1.0.5 AppImage with the current lean 1.0.6 package.

This result records what users of that package could experience. Do not use it as the primary optimization claim because the 1.0.5 package included unrelated files.

This comparison includes all application, package, process-layout, and Electron fork changes. It does not isolate one optimization.

Both packages use Electron 43.2.0, Chromium 150.0.7871.129, and Node 24.18.0.

The audit used this balanced order:

```text
1.0.5, 1.0.6, 1.0.6, 1.0.5, 1.0.5,
1.0.6, 1.0.6, 1.0.5, 1.0.5, 1.0.6
```

Each run used a fresh Chromium data directory. Each run used the real WinBoat installation data.

The audit waited for the validated Home screen. It then allowed a 20-second settle period before the memory sample.

The table contains the median of five runs for each version:

| Metric | WinBoat 1.0.5 | WinBoat 1.0.6 | Saving |
| --- | ---: | ---: | ---: |
| RSS, summed | 858.1 MiB | 617.7 MiB | 240.4 MiB, or 28.0 percent |
| PSS | 427.3 MiB | 322.4 MiB | 104.9 MiB, or 24.5 percent |
| USS/private | 296.7 MiB | 220.2 MiB | 76.6 MiB, or 25.8 percent |

PSS is the primary physical-memory result. Summed RSS counts shared pages more than one time.

The process-group PSS medians were:

| Process group | WinBoat 1.0.5 | WinBoat 1.0.6 | Change |
| --- | ---: | ---: | ---: |
| Browser | 137.9 MiB | 111.7 MiB | -26.2 MiB |
| Three zygote entries | 30.5 MiB | 19.6 MiB | -10.8 MiB |
| GPU | 79.9 MiB | 74.2 MiB | -5.7 MiB |
| Renderer | 152.5 MiB | 116.2 MiB | -36.3 MiB |
| Network utility | 28.4 MiB | No separate process | Process moved in-process |

Independent group medians do not add exactly to the total median.

WinBoat 1.0.5 used seven processes. WinBoat 1.0.6 used six processes.

The 1.0.6 main process hosts the network service. Thus, the removed utility-process value is not a pure saving.

The package-size comparison was:

| Scope | WinBoat 1.0.5 | WinBoat 1.0.6 | Saving |
| --- | ---: | ---: | ---: |
| AppImage | 486,001,177 bytes | 214,205,690 bytes | 271,795,487 bytes, or 55.9 percent |
| Unpacked runtime | 1,044,525,057 bytes | 510,979,896 bytes | 533,545,161 bytes, or 51.1 percent |
| Application archive | 453,770,285 bytes | 51,591,986 bytes | 402,178,299 bytes, or 88.6 percent |
| Electron executable | 219,917,560 bytes | 165,477,624 bytes | 54,439,936 bytes, or 24.8 percent |

The 1.0.5 application archive contained 19,550 entries. It included Git history, source, tests, temporary files, and the broad dependency tree.

The 1.0.6 application archive contains 4,322 entries. Its roots are `main`, `renderer`, `node_modules`, and `package.json`.

The archive reduction is primarily a disk result. Do not attribute all RAM savings to excluded package files.

All ten runs opened Home with the Guest API online and the container running.

Local storage, IndexedDB, WebAssembly, `en-US`, and hardware GPU acceleration passed in all runs.

Both packages used ANGLE OpenGL and GaneshGL. GPU compositing, GPU rasterization, and WebGL remained enabled.

The raw result is `/tmp/winboat-memory-1.0.5-vs-1.0.6.json`.

### Explicitly retained after the audit

- DevTools, inspector protocol, tracing/Perfetto, dedicated workers used by DevTools, and WebAssembly
- Multiprocess sandboxing and the zygote model
- GPU compositing, GPU rasterization, Skia, ANGLE/OpenGL, Ozone/Aura, and both X11 and Wayland for now
- Node, libuv, N-API, native addon loading, and the Node built-ins used directly or transitively by WinBoat
- HTTP/HTTPS, DNS, TLS, `fetch`, `file:`, `data:`, and `blob:` support
- Native file dialogs, shell integration, clipboard/editing support, ICU, text shaping, accessibility core, PNG, WebP, SVG, WOFF2, and the DOM features required by Vue/Xel
- The HSTS preload list and BackupRefPtr until their security trade-offs are explicitly accepted
- WebSockets until attached DevTools and remote-debugging expectations are tested with the page-facing implementation compiled out

## Known limitations and next work

- Only Linux x86-64 has a published fork build.
- The published tag records the complete Electron, Chromium, and Node patch series.
- The final artifact passed Home, Setup, hardware-GPU, forced-SwiftShader, storage, WebAssembly, USB, and DevTools tests.
- Disabled feature combinations have little upstream build coverage. Every new batch needs compile, launch, GPU-status, native-addon, route, and memory regression tests.
- Electron accessibility code wires Screen AI unconditionally. The fork does not disable it because no measured RAM benefit justifies the larger change.
- The published symbols confirm the removal of Dawn native, Tint, and SPIR-V Tools code.
- WebRTC can pull TensorFlow Lite code through its neural echo estimator. This can reduce binary size, but no PSS benefit exists yet.
- Package-time Electron fuses should be reviewed for security and capability reduction, but most do not remove compiled code or automatically reduce idle RAM.
- `optimize_for_size` produced a smaller executable. Measure each future compiler or linker change because size optimization can change code layout and CPU use.

## Reproduction checklist

1. Apply the recorded Chromium, Electron, and Node helper patches to the exact revisions above.
2. Generate the Electron-rooted GN graph with the recorded arguments.
3. Build `electron:electron_dist_zip`.
4. Verify the ZIP and assemble WinBoat with byte-identical application payloads.
5. Confirm Electron/Chromium/Node versions and native USB loading.
6. Confirm Setup and Home routes match stock.
7. Confirm GPU rasterization/compositing and DevTools.
8. Alternate at least three stock/lean PSS measurements on the same screen.
9. Treat a process-count reduction, executable-size reduction, or summed-RSS reduction as supporting evidence—not as a substitute for whole-tree PSS.
