import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

const powershell = Bun.which("pwsh") || Bun.which("powershell");
const testPowerShell = powershell ? test : test.skip;
const directory = mkdtempSync(join(tmpdir(), "winboat-guest-paths-"));
const marker = join(directory, "injected");
const scripts = join(import.meta.dir, "../guest_server/scripts");
const injection = `‘; [IO.File]::WriteAllText('${marker.replaceAll("'", "''")}', 'injected'); #`;
const executable = powershell ? basename(powershell) : "pwsh";
const env = {
    ...process.env,
    PATH: `${powershell ? dirname(powershell) : ""}${delimiter}${process.env.PATH}`,
    WB_TEST_REMOTE: "\\\\server\\share",
    WB_TEST_PROBE: join(directory, "filesystem-probe"),
};
afterAll(() => rmSync(directory, { recursive: true, force: true }));

for (const [name, path, args, statuses] of [
    ["smart quote path", `C:\\Apps\\${injection}`, "", ["unknown", "missing"]],
    ["smart quote arguments", executable, injection, ["valid"]],
    ["ASCII quote arguments", executable, injection.replace("‘", "'"), ["valid"]],
    ["expressions in path", "C:\\Apps\\$(Write-Output injected).exe", "", ["unknown", "missing"]],
    ["Unicode path", "C:\\Apps\\O’Brien's 日本語\\tool.exe", "", ["unknown", "missing"]],
    ["provider UNC", "Microsoft.PowerShell.Core\\FileSystem::\\\\server\\share\\app.exe", "", ["unknown"]],
    ["UNC", "\\\\server\\share\\app.exe", "", ["unknown"]],
    ["mixed UNC", "\\/server\\share\\app.exe", "", ["unknown"]],
    ["expanded UNC", "%WB_TEST_REMOTE%\\app.exe", "", ["unknown"]],
    ["relative path", "..\\app.exe", "", ["unknown"]],
    ["wildcard command", "pw*", "", ["unknown"]],
    ["user environment", "%APPDATA%\\app.exe", "", ["unknown"]],
    ["control character", "C:\\app\n.exe", "", ["unknown"]],
] as const) {
    testPowerShell(`guest validation treats ${name} as data`, () => {
        const result = spawnSync(
            powershell!,
            ["-NoProfile", "-NonInteractive", "-File", join(scripts, "validate-app.ps1")],
            {
                input: JSON.stringify({ path, args }),
                encoding: "utf8",
                env,
                timeout: 10000,
            },
        );
        expect(result.status).toBe(0);
        expect(statuses).toContain(result.stdout.trim());
        expect(existsSync(marker)).toBe(false);
    });
}

const wrapper = join(directory, "icon-probes.ps1");
writeFileSync(
    wrapper,
    `param([string]$Target, [string]$Script)
function global:Test-Path { [IO.File]::WriteAllText($env:WB_TEST_PROBE, 'access'); throw 'Unexpected filesystem probe' }
function global:Resolve-Path { [IO.File]::WriteAllText($env:WB_TEST_PROBE, 'access'); throw 'Unexpected filesystem probe' }
& $Script -Path $Target
`,
);
for (const target of [
    "\\\\server\\share\\icon.ico",
    "Microsoft.PowerShell.Core\\FileSystem::\\\\server\\share\\icon.ico",
    "%WB_TEST_REMOTE%\\icon.ico",
]) {
    testPowerShell(`icon rejects ${target} before probing the filesystem`, () => {
        const result = spawnSync(
            powershell!,
            [
                "-NoProfile",
                "-NonInteractive",
                "-File",
                wrapper,
                "-Target",
                target,
                "-Script",
                join(scripts, "get-icon.ps1"),
            ],
            {
                encoding: "utf8",
                env,
                timeout: 10000,
            },
        );
        expect(result.status).toBe(0);
        expect(result.stdout.trim().startsWith("iVBOR")).toBe(true);
        expect(existsSync(env.WB_TEST_PROBE)).toBe(false);
    });
}

testPowerShell("icon rejects remote paths inside a local shortcut", () => {
    const linkWrapper = join(directory, "link-probes.ps1");
    writeFileSync(
        linkWrapper,
        `param([string]$Script)
function global:Test-Path {
    param([string]$LiteralPath, [string]$PathType)
    if ($LiteralPath -eq 'C:\\local.lnk') { return $true }
    [IO.File]::WriteAllText($env:WB_TEST_PROBE, 'access')
    throw 'Unexpected filesystem probe'
}
function global:Resolve-Path { [IO.File]::WriteAllText($env:WB_TEST_PROBE, 'access'); throw 'Unexpected filesystem probe' }
function global:New-Object {
    param([string]$ComObject, [switch]$Strict)
    $shell = [pscustomobject]@{}
    $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
        [pscustomobject]@{ IconLocation = '\\\\server\\share\\icon.ico,0'; TargetPath = '\\\\server\\share\\app.exe' }
    }
    return $shell
}
& $Script -Path 'C:\\local.lnk'
`,
    );
    const result = spawnSync(
        powershell!,
        ["-NoProfile", "-NonInteractive", "-File", linkWrapper, "-Script", join(scripts, "get-icon.ps1")],
        {
            encoding: "utf8",
            env,
            timeout: 10000,
        },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim().startsWith("iVBOR")).toBe(true);
    expect(existsSync(env.WB_TEST_PROBE)).toBe(false);
});

const uwpWrapper = join(directory, "uwp-validation.ps1");
writeFileSync(
    uwpWrapper,
    `param([string]$Script)
$ErrorActionPreference = 'Stop'
$drive = 90..65 | ForEach-Object { [string][char]$_ } | Where-Object { -not (Get-PSDrive -Name $_ -ErrorAction SilentlyContinue) } | Select-Object -First 1
New-PSDrive -Name $drive -PSProvider FileSystem -Root $env:WB_TEST_PACKAGES | Out-Null
$global:uwpTestPackages = @(Get-ChildItem -LiteralPath $env:WB_TEST_PACKAGES -Directory | ForEach-Object {
    [pscustomobject]@{
        PackageFamilyName = 'Microsoft.BingWeather_8wekyb3d8bbwe'
        PackageFullName = $_.Name
        InstallLocation = $drive + ':\\' + $_.Name
    }
})
function global:Get-AppxPackage { param([switch]$AllUsers) $global:uwpTestPackages }
# This is what the real cmdlet returns for Bing Weather under SYSTEM.
function global:Get-AppxPackageManifest { param($Package) $null }
& $Script
`,
);
const appManifest = (id: string) =>
    `<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Applications><Application Id="${id}" /></Applications></Package>`;
for (const [name, manifests, appId, status] of [
    ["installed for another user", [appManifest("App")], "App", "valid"],
    ["removed package", [], "App", "missing"],
    ["removed application ID", [appManifest("OtherApp")], "App", "missing"],
    ["multiple package versions", [appManifest("OtherApp"), appManifest("App")], "App", "valid"],
    ["unreadable manifest", [null], "App", "unknown"],
    ["malformed manifest", ["<Package>"], "App", "unknown"],
    ["empty manifest", [""], "App", "unknown"],
] as const) {
    testPowerShell(`UWP validation handles ${name}`, () => {
        const packages = mkdtempSync(join(directory, "packages-"));
        for (const [index, manifest] of manifests.entries()) {
            const folder = join(packages, `package${index}`);
            mkdirSync(folder);
            if (manifest !== null) writeFileSync(join(folder, "AppxManifest.xml"), manifest);
        }
        const result = spawnSync(
            powershell!,
            ["-NoProfile", "-NonInteractive", "-File", uwpWrapper, "-Script", join(scripts, "validate-app.ps1")],
            {
                input: JSON.stringify({
                    path: "explorer.exe",
                    args: `shell:AppsFolder\\Microsoft.BingWeather_8wekyb3d8bbwe!${appId}`,
                }),
                encoding: "utf8",
                env: { ...env, WB_TEST_PACKAGES: packages },
                timeout: 10000,
            },
        );
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(status);
    });
}
