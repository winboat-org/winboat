# Desktop shortcuts

Shortcuts invoke WinBoat through a stable launcher in `$XDG_DATA_HOME/winboat-app`
(normally `~/.local/share/winboat-app`). They use the current WinBoat configuration
and FreeRDP selection at launch time (bundled by default, or the optional detected system client). WinBoat does not add an automatic
reconnect flag.

## Files

- `launch`: a small POSIX shell script, invoked with a shortcut ID.
- `launcher.conf`: installation type, executable, then one argument per line.
  The script reads these as literal arguments; it does not evaluate shell code
  or require Python/jq. Line breaks in launcher arguments are rejected.
- `shortcuts.json`: versioned records containing each shortcut's original Windows
  target, display name, extra Windows arguments, and generated desktop-file paths.
- `shortcut-icons/`: persistent PNG icons independent of the WinBoat executable.
- `winboat.config.json`: the existing configuration also stores close behavior, shutdown on quit, and automatic shortcut startup.

For example, a native launcher configuration contains:

```text
bin
/usr/bin/winboat
```

Flatpak launchers use `flatpak` as the executable, followed by `run` and the app ID
on separate lines. This describes the launch command; the repository's existing
build targets still determine which installation formats are produced.

On normal startup, installed builds offer to switch an existing launcher to the
current installation. Declining preserves the saved launcher. Development builds
do not replace it. Moving an AppImage does not change any generated desktop files;
open the replacement build and accept the launcher update.

## Behavior

One shortcut record belongs to an original Windows path and argument string.
Desktop and Applications menu copies share that record. Editing changes the name,
extra arguments, or destinations; deleting removes both owned copies.

The renderer owns shortcut files, launcher configuration, preferences, logs, and
VM/RDP control. It uses the existing constants, typed Node requires, and
WinboatConfig. Main only manages the tray, native dialogs and windows, and delivers
launch requests to the main renderer. The small, fixed-size shortcut window presents
state and sends user actions back; it never starts a second Winboat instance.

Launches are queued, duplicate pending IDs are ignored, and startup operations
are shared. A stopped/paused VM asks to start/resume unless automatic startup was
selected. An unknown container status is retried for up to one minute before a
status-check error is shown; it does not trigger a start prompt or automatic start.
After starting the container, the guest has one minute to become ready,
including any guest update and retries for an unknown container status. If status
is still unknown at that deadline, the status-check error is shown instead of a
stopped-container or guest-service error. Container failure is reported separately.
Transient guest version or health failures are retried while the guest is online;
only one version check or update runs at a time.

The authenticated guest endpoint `/apps/validate` distinguishes a missing target
from an unverifiable one. Native paths and UWP identities are checked inside
Windows; unresolved user-specific paths are not treated as uninstalled apps.
UWP checks read each package's installed manifest because the guest service runs
as SYSTEM and the user-scoped manifest cmdlet can return nothing for an installed app.
Unreadable manifests are treated as unverifiable.

FreeRDP runs detached. Successful process creation produces a “Launch requested”
notification and closes the startup window after two seconds. During that handoff,
the window shrinks to 600×200 and keeps an indeterminate Xel loading bar along its
bottom edge. Starting also shows the bar; confirmation and error states use the
larger 600×280 window with room for their actions. It does not claim that a
remote window rendered. Unexpected exit codes are logged, with an error dialog
only if the process exits within ten seconds of starting. Normal window and tray
quits honor the shutdown-on-quit setting (off by default); otherwise Windows and
FreeRDP keep running. The shortcut error window's Quit WinBoat action always
leaves Windows running, regardless of that setting. Closing to the tray also
leaves Windows running.
If the container runtime is unavailable, quitting exits without another prompt,
even with shutdown on quit enabled.
Prompt buttons sit above the window's bottom padding; longer error and log
content remains scrollable.

Container failures in the dashboard and shortcut window share the same error/log
UI. Failure actions are Open logs and Quit WinBoat (or Close in the dashboard).
Clean container exits do not open an error dialog. Stops observed outside
WinBoat's power controls are inspected for a failed exit or out-of-memory kill
before a container error is shown.
Guest-service failures also offer the troubleshooting guide; container, status-check,
and FreeRDP failures do not. Guest validation request failures and malformed responses
are treated as guest-service errors. Windows shutdown stays in the normal power controls.
Logs include recent Docker/Podman output, container action logs, and WinBoat's
log. FreeRDP stdout/stderr is saved to `freerdp.log` and available in the same
viewer. Each launch replaces this file; older sessions cannot write into the
latest log. Output continues to be written after WinBoat quits.
External editor/terminal integration is intentionally left for later.

## Checks

```sh
bun test tests
bunx tsc --noEmit -p src/main/tsconfig.json
bunx vue-tsc --noEmit --skipLibCheck -p src/renderer/tsconfig.json
bun scripts/build.ts
bash build-guest-server.sh
```

The renderer check skips existing third-party declaration errors. Build the guest
payload as well as the host: `validate-app.ps1` and `path-utils.ps1` must ship
alongside the server. Guest script security tests run when `pwsh` or `powershell`
is on PATH; otherwise Bun skips those tests. Go tests also check that request
data reaches the validator through JSON stdin, never PowerShell command text.

Before release, exercise a native app and a UWP app against Windows; remove an app
and check the deletion prompt. Also check a stopped/paused container, guest timeout,
container failure, cancellation, multiple shortcut clicks, and quitting with an
open Windows application. Test desktop placement and tray behavior on the desktop
environments supported by the release.
