import { ComposeConfig } from "../../../types";
import { DOCKER_DEFAULT_COMPOSE } from "../../data/docker";
import { GUEST_NOVNC_PORT, GUEST_QMP_PORT, WINBOAT_DIR } from "../constants";
import {
    ComposeArguments,
    ComposeDirection,
    ContainerAction,
    containerLogger,
    ContainerManager,
    ContainerStatus,
} from "./container";
import YAML from "yaml";
import { capitalizeFirstLetter } from "../../utils/capitalize";
import { execFileAsync, stringifyExecFile } from "../exec-helper";

const path: typeof import("node:path") = require("node:path");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const { spawn }: typeof import("node:child_process") = require("node:child_process");

// OCI image pulls are large; give init a roomy output buffer.
const INIT_MAX_BUFFER = 64 * 1024 * 1024;

// stdin must be closed: `incus init` reads config from stdin when it's not a TTY,
// and Electron's default open pipe would hang it forever. All incus calls go here.
function runIncus(args: string[], options: { maxBuffer?: number } = {}): Promise<{ stdout: string; stderr: string }> {
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const child = spawn("incus", args, { stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        child.stdout.on("data", chunk => {
            stdout += chunk;
            if (stdout.length > maxBuffer) {
                child.kill();
                fail(new Error(`incus ${args.join(" ")} exceeded stdout maxBuffer`));
            }
        });
        child.stderr.on("data", chunk => {
            stderr += chunk;
        });
        child.on("error", fail);
        child.on("close", code => {
            if (settled) return;
            settled = true;
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const err = new Error(`incus ${args.join(" ")} exited with code ${code}`) as Error & {
                    code?: number;
                    stdout?: string;
                    stderr?: string;
                };
                err.code = code ?? undefined;
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            }
        });
    });
}

export type IncusSpecs = {
    incusInstalled: boolean;
    incusRunning: boolean;
    skopeoInstalled: boolean;
};

type ParsedImageRef = {
    /** e.g. `https://ghcr.io` */
    registryUrl: string;
    /** Stable, sanitized Incus remote name, e.g. `wb-ghcr-io` */
    remoteName: string;
    /** Repo + tag passed after the remote, e.g. `dockur/windows:6.01` */
    repoAndTag: string;
};

// Incus does no shell-style interpolation, so expand `${HOME}`/`$HOME` ourselves.
export function expandHome(value: string): string {
    const home = os.homedir();
    return value.replace(/\$\{HOME\}/g, home).replace(/\$HOME/g, home);
}

// Splits `ghcr.io/dockur/windows:6.03` into the OCI remote + repo:tag Incus needs.
export function parseImageRef(image: string): ParsedImageRef {
    const firstSlash = image.indexOf("/");
    if (firstSlash === -1) {
        throw new Error(`Cannot parse OCI image reference '${image}': missing registry host`);
    }

    const host = image.slice(0, firstSlash);
    const repoAndTag = image.slice(firstSlash + 1);
    const remoteName = `wb-${host.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;

    return {
        registryUrl: `https://${host}`,
        remoteName,
        repoAndTag,
    };
}

// `incus init` args: privileged + nesting, plus one `-c environment.K=V` per env
// var. Devices are added separately (`init -d` only overrides existing profile ones).
export function buildInitArgs(compose: ComposeConfig, imageSource: string, name: string): string[] {
    const args = ["init", imageSource, name, "-c", "security.privileged=true", "-c", "security.nesting=true"];

    for (const [key, value] of Object.entries(compose.services.windows.environment)) {
        args.push("-c", `environment.${key}=${expandHome(String(value))}`);
    }

    return args;
}

// Ports dockur serves inside the container (VNC/noVNC/QMP) → proxy to loopback.
// Everything else (guest API, RDP) is NAT'd to the VM, so its proxy must target the
// VM IP (dockur DNATs only in PREROUTING, which a loopback forkproxy would miss).
const CONTAINER_SERVED_GUEST_PORTS = new Set([5900, GUEST_NOVNC_PORT, GUEST_QMP_PORT]);

// Compose devices → `unix-char`, volumes → `disk`. Added before start so dockur
// sees /dev/kvm and /storage at boot. Host paths are ${HOME}-expanded and resolved
// relative to the compose dir; named volumes (bare tokens like `data`) are skipped.
export function buildInstanceDevices(compose: ComposeConfig, name: string, composeDir: string): string[][] {
    const service = compose.services.windows;
    const commands: string[][] = [];
    const namedVolumes = new Set(Object.keys(compose.volumes ?? {}));

    // Character devices (/dev/kvm from compose, plus tun which the guest needs).
    const charDevices = new Set<string>(service.devices ?? []);
    charDevices.add("/dev/net/tun");
    for (const dev of charDevices) {
        const devName = dev.replace(/^\/+/, "").replace(/\//g, "-");
        commands.push(["config", "device", "add", name, devName, "unix-char", `source=${dev}`, `path=${dev}`]);
    }

    // Volumes -> disk devices.
    for (const volume of service.volumes ?? []) {
        const sep = volume.indexOf(":");
        if (sep === -1) continue;

        const rawHost = volume.slice(0, sep);
        const container = volume.slice(sep + 1);

        // USB needs Incus's native `usb` device for cgroup access (major 189) +
        // hotplug. A plain bind mount only makes nodes visible, not openable → QEMU
        // usb-host passthrough would fail with EPERM.
        if (rawHost === "/dev/bus/usb") {
            commands.push(["config", "device", "add", name, "usb", "usb"]);
            continue;
        }

        if (namedVolumes.has(rawHost)) {
            containerLogger.warn(`[incus] Skipping named volume '${volume}' (host path required for Incus)`);
            continue;
        }

        let host = expandHome(rawHost);
        if (!path.isAbsolute(host)) {
            host = path.resolve(composeDir, host);
        }

        const devName = container.replace(/^\/+/, "").replace(/\//g, "-") || "root";
        commands.push(["config", "device", "add", name, devName, "disk", `source=${host}`, `path=${container}`]);
    }

    return commands;
}

// Compose ports (`127.0.0.1:47273:3389/udp`) → Incus `proxy` devices. Added after
// start, once vmIp is known. See CONTAINER_SERVED_GUEST_PORTS for loopback vs VM IP.
export function buildProxyDevices(compose: ComposeConfig, name: string, vmIp: string): string[][] {
    const service = compose.services.windows;
    const commands: string[][] = [];

    for (const mapping of service.ports ?? []) {
        const [addrPart, proto = "tcp"] = mapping.split("/");
        const segments = addrPart.split(":");
        // Expected shape: IP:HOST_PORT:GUEST_PORT
        if (segments.length < 3) {
            containerLogger.warn(`[incus] Skipping unrecognized port mapping '${mapping}'`);
            continue;
        }

        const guestPort = segments[segments.length - 1];
        const hostPort = segments[segments.length - 2];
        const listenAddr = segments.slice(0, segments.length - 2).join(":") || "127.0.0.1";
        const connectHost = CONTAINER_SERVED_GUEST_PORTS.has(Number(guestPort)) ? "127.0.0.1" : vmIp;

        commands.push([
            "config",
            "device",
            "add",
            name,
            `proxy-${guestPort}-${proto}`,
            "proxy",
            `listen=${proto}:${listenAddr}:${hostPort}`,
            `connect=${proto}:${connectHost}:${guestPort}`,
            "bind=host",
        ]);
    }

    return commands;
}

// dockur's VM IP = container IP with the prefix swapped to 172.30, last two octets
// kept (10.13.67.35 -> 172.30.67.35).
export function deriveVmIp(containerIp: string): string {
    const octets = containerIp.split(".");
    return `172.30.${octets[2]}.${octets[3]}`;
}

/** The subset of an `incus list --format json` entry that we rely on. */
type InstanceInfo = {
    name: string;
    status: string;
    state?: { network?: { eth0?: { addresses?: { family: string; address: string }[] } } };
};

export class IncusContainer extends ContainerManager {
    // Incus has no `compose`, but takes the same compose shape as Docker (Podman
    // differs). Reuse the Docker template and translate it to CLI calls at runtime.
    defaultCompose = DOCKER_DEFAULT_COMPOSE;
    composeFilePath = path.join(WINBOAT_DIR, "incus-compose.yml");
    executableAlias = "incus";

    writeCompose(compose: ComposeConfig): void {
        const composeContent = YAML.stringify(compose, { nullStr: "" });
        fs.writeFileSync(this.composeFilePath, composeContent, { encoding: "utf-8" });

        containerLogger.info(`Wrote to compose file at: ${this.composeFilePath}`);
        containerLogger.info(`Compose file content:\n${composeContent}`);
    }

    // Reads the on-disk compose (source of truth), falling back to the default.
    private readComposeFromDisk(): ComposeConfig {
        if (!fs.existsSync(this.composeFilePath)) {
            return this.defaultCompose;
        }
        return YAML.parse(fs.readFileSync(this.composeFilePath, "utf-8")) as ComposeConfig;
    }

    /** Idempotently registers the OCI registry as an Incus remote. */
    private async ensureRemote(remoteName: string, registryUrl: string): Promise<void> {
        try {
            const { stdout } = await runIncus(["remote", "list", "--format", "csv"]);
            const alreadyExists = stdout.split("\n").some(line => line.split(",")[0] === remoteName);
            if (alreadyExists) return;
        } catch (e) {
            containerLogger.error("Failed to list Incus remotes");
            containerLogger.error(e);
        }

        try {
            await runIncus(["remote", "add", remoteName, registryUrl, "--protocol=oci"]);
            containerLogger.info(`[incus] Added OCI remote '${remoteName}' -> ${registryUrl}`);
        } catch (e) {
            // A concurrent add or pre-existing remote is fine; surface anything else.
            containerLogger.warn(`[incus] Could not add remote '${remoteName}' (may already exist)`);
            containerLogger.warn(e);
        }
    }

    /** Creates the instance from the compose config and starts it. */
    private async createAndStart(): Promise<void> {
        const compose = this.readComposeFromDisk();
        const { remoteName, registryUrl, repoAndTag } = parseImageRef(compose.services.windows.image);

        await this.ensureRemote(remoteName, registryUrl);

        const initArgs = buildInitArgs(compose, `${remoteName}:${repoAndTag}`, this.containerName);
        try {
            await runIncus(initArgs, { maxBuffer: INIT_MAX_BUFFER });
            containerLogger.info(`[incus] Initialized instance '${this.containerName}'`);
        } catch (e) {
            containerLogger.error(`Failed to init Incus instance '${stringifyExecFile("incus", initArgs)}'`);
            containerLogger.error(e);
            throw e;
        }

        // Devices (/dev/kvm, tun, /storage, /oem) must exist before dockur boots QEMU.
        const deviceCommands = buildInstanceDevices(compose, this.containerName, path.dirname(this.composeFilePath));
        for (const args of deviceCommands) {
            await this.runDeviceCommand(args);
        }

        await runIncus(["start", this.containerName]);
        containerLogger.info(`[incus] Started instance '${this.containerName}'`);

        // Derive the VM IP from the container IP (pin it so it survives restarts).
        const containerIp = await this.getContainerIp();
        const vmIp = deriveVmIp(containerIp);
        containerLogger.info(`[incus] Container IP ${containerIp} -> Windows VM IP ${vmIp}`);
        await this.pinStaticIp(containerIp);

        const proxyCommands = buildProxyDevices(compose, this.containerName, vmIp);
        for (const args of proxyCommands) {
            await this.runDeviceCommand(args);
        }
    }

    private async runDeviceCommand(args: string[]): Promise<void> {
        try {
            await runIncus(args);
        } catch (e) {
            containerLogger.error(`Failed to add Incus device '${stringifyExecFile("incus", args)}'`);
            containerLogger.error(e);
            throw e;
        }
    }

    /** Returns this instance's `incus list` entry, or undefined if it doesn't exist. */
    private async inspect(): Promise<InstanceInfo | undefined> {
        const { stdout } = await runIncus(["list", this.containerName, "--format", "json"]);
        const instances = JSON.parse(stdout) as InstanceInfo[];
        return instances.find(i => i.name === this.containerName);
    }

    // Reads the container IPv4 from `incus list`, retrying since the DHCP lease can
    // land shortly after `incus start` returns.
    private async getContainerIp(): Promise<string> {
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const instance = await this.inspect();
                const address = instance?.state?.network?.eth0?.addresses?.find(a => a.family === "inet")?.address;
                if (address) return address;
            } catch (e) {
                containerLogger.warn("[incus] Failed to read container IP from `incus list`");
                containerLogger.warn(e);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        throw new Error("[incus] Could not determine the container IP from `incus list`");
    }

    // Pins eth0 to a static IP so the derived VM IP (proxy targets) survives
    // restarts. Best-effort.
    private async pinStaticIp(address: string): Promise<void> {
        try {
            await runIncus(["config", "device", "override", this.containerName, "eth0", `ipv4.address=${address}`]);
            containerLogger.info(`[incus] Pinned eth0 static IP ${address}`);
        } catch (e) {
            containerLogger.warn("[incus] Could not pin static container IP (VM IP may change across restarts)");
            containerLogger.warn(e);
        }
    }

    async compose(direction: ComposeDirection, _extraArgs: ComposeArguments[] = []): Promise<void> {
        if (direction === "down") {
            // Equivalent to `compose down`: stop (if running) and delete the instance.
            try {
                await runIncus(["stop", this.containerName, "--force"]);
            } catch (e) {
                containerLogger.warn(`[incus] Stop during 'down' failed (instance may already be stopped)`);
                containerLogger.warn(e);
            }
            try {
                await runIncus(["delete", this.containerName, "--force"]);
                containerLogger.info(`[incus] Deleted instance '${this.containerName}'`);
            } catch (e) {
                containerLogger.error(`Failed to delete Incus instance '${this.containerName}'`);
                containerLogger.error(e);
                throw e;
            }
            return;
        }

        // direction === "up"
        try {
            if (await this.exists()) {
                // Already created; bring it up idempotently based on current state.
                const status = await this.getStatus();
                if (status === ContainerStatus.RUNNING) return;
                if (status === ContainerStatus.PAUSED) {
                    await runIncus(["resume", this.containerName]);
                    return;
                }
                await runIncus(["start", this.containerName]);
                return;
            }

            await this.createAndStart();
        } catch (e) {
            containerLogger.error(`Failed to bring up Incus instance '${this.containerName}'`);
            containerLogger.error(e);
            throw e;
        }
    }

    async container(action: ContainerAction): Promise<void> {
        // Restart = stop + start, to reuse the robust stop below (`incus restart`
        // shares `incus stop`'s graceful-hang pitfall).
        if (action === "restart") {
            await this.container("stop");
            await this.container("start");
            return;
        }

        // `incus stop` errors when already stopped and never force-kills on timeout
        // (unlike `docker stop`). Make it idempotent + force-fallback so a hung
        // graceful shutdown can't block callers (e.g. reset stops before deleting).
        if (action === "stop") {
            if ((await this.getStatus()) === ContainerStatus.EXITED) {
                containerLogger.info("[incus] Stop requested but instance already stopped; nothing to do");
                return;
            }
            try {
                await runIncus(["stop", this.containerName, "--timeout", "120"]);
            } catch (e) {
                containerLogger.warn("[incus] Graceful stop failed or timed out, forcing");
                containerLogger.warn(e);
                await runIncus(["stop", this.containerName, "--force"]);
            }
            containerLogger.info("[incus] Stopped instance");
            return;
        }

        const actionArgs: Record<"start" | "pause" | "unpause", string[]> = {
            start: ["start", this.containerName],
            pause: ["pause", this.containerName],
            unpause: ["resume", this.containerName],
        };

        const args = actionArgs[action];
        try {
            const { stdout } = await runIncus(args);
            containerLogger.info(`Container action '${action}' response: '${stdout}'`);
        } catch (e) {
            containerLogger.error(`Failed to run container action '${stringifyExecFile("incus", args)}'`);
            containerLogger.error(e);
            throw e;
        }
    }

    async remove(): Promise<void> {
        const args = ["delete", this.containerName, "--force"];
        try {
            await runIncus(args);
        } catch (e) {
            containerLogger.error(`Failed to remove container '${this.containerName}'`);
            containerLogger.error(e);
        }
    }

    async getStatus(): Promise<ContainerStatus> {
        // Don't map Incus's transient "Error" status to ContainerStatus.ERROR:
        // winboat.ts treats ERROR as sticky, so a brief "Error" during a normal stop
        // would freeze the UI. ERROR is set only on failed start/restart actions
        // (like Docker/Podman). Unlisted statuses fall through to UNKNOWN.
        const statusMap: Record<string, ContainerStatus> = {
            Running: ContainerStatus.RUNNING,
            Frozen: ContainerStatus.PAUSED,
            Stopped: ContainerStatus.EXITED,
        };

        try {
            const instance = await this.inspect();
            if (!instance) return ContainerStatus.UNKNOWN;
            return statusMap[instance.status] ?? ContainerStatus.UNKNOWN;
        } catch (e) {
            containerLogger.error("Failed to get status of incus container");
            containerLogger.error(e);
            return ContainerStatus.UNKNOWN;
        }
    }

    async exists(): Promise<boolean> {
        try {
            return !!(await this.inspect());
        } catch (e) {
            containerLogger.error(
                `Failed to check container existence, is ${capitalizeFirstLetter(this.executableAlias)} installed?`,
            );
            containerLogger.error(e);
            return false;
        }
    }

    get containerName(): string {
        return this.defaultCompose.services.windows.container_name;
    }

    static override async _getSpecs(): Promise<IncusSpecs> {
        let specs: IncusSpecs = {
            incusInstalled: false,
            incusRunning: false,
            skopeoInstalled: false,
        };

        try {
            const { stdout: incusVersion } = await runIncus(["version"]);
            specs.incusInstalled = !!incusVersion;
        } catch (e) {
            containerLogger.error("Error checking incus version");
            containerLogger.error(e);
        }

        // `incus list` succeeding proves the daemon is reachable AND that the user
        // has socket access (i.e. is in the incus-admin group).
        try {
            await runIncus(["list", "--format", "csv"]);
            specs.incusRunning = true;
        } catch (e) {
            containerLogger.error("Error checking if incus daemon is reachable");
            containerLogger.error(e);
        }

        // Incus OCI support requires skopeo on the host to pull images.
        try {
            const { stdout: skopeoVersion } = await execFileAsync("skopeo", ["--version"]);
            specs.skopeoInstalled = !!skopeoVersion;
        } catch (e) {
            containerLogger.error("Error checking skopeo version");
            containerLogger.error(e);
        }

        return specs;
    }
}
