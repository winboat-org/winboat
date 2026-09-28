export type DistroFamily = "debian" | "fedora" | "arch" | "suse";

const FAMILY_BY_ID: Record<string, DistroFamily> = {
    debian: "debian",
    ubuntu: "debian",
    linuxmint: "debian",
    pop: "debian",
    neon: "debian",
    zorin: "debian",
    elementary: "debian",
    fedora: "fedora",
    arch: "arch",
    endeavouros: "arch",
    manjaro: "arch",
    garuda: "arch",
    "opensuse-leap": "suse",
    "opensuse-tumbleweed": "suse",
    sled: "suse",
    sles: "suse",
    suse: "suse",
    opensuse: "suse",
};

function parseOsRelease(content: string): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const line of content.split("\n")) {
        const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (!match) continue;
        fields[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return fields;
}

export function detectDistroFamily(osReleaseContent: string): DistroFamily | null {
    const fields = parseOsRelease(osReleaseContent);
    const id = fields.ID?.toLowerCase();
    if (id && FAMILY_BY_ID[id]) return FAMILY_BY_ID[id];
    for (const token of (fields.ID_LIKE || "").toLowerCase().split(/\s+/)) {
        if (FAMILY_BY_ID[token]) return FAMILY_BY_ID[token];
    }
    return null;
}

const INSTALL_COMMANDS: Record<DistroFamily, string[]> = {
    debian: [
        "apt-get update",
        "apt-get install -y docker.io docker-compose-v2 || apt-get install -y docker.io docker-compose",
    ],
    fedora: ["dnf install -y moby-engine docker-cli docker-compose"],
    arch: ["pacman -Sy --noconfirm docker docker-compose"],
    suse: ["zypper --non-interactive install docker docker-compose"],
};

const ENABLE_SERVICE_COMMAND = "systemctl enable --now docker";

export function getDockerInstallPlan(family: DistroFamily, username: string): string[] {
    return [...INSTALL_COMMANDS[family], ENABLE_SERVICE_COMMAND, `usermod -aG docker ${username}`];
}

// Rootless podman needs no service unit and no supplementary group, so unlike the
// docker plan there is nothing to enable and no logout required after installing.
const PODMAN_INSTALL_COMMANDS: Record<DistroFamily, string[]> = {
    debian: ["apt-get update", "apt-get install -y podman podman-compose"],
    fedora: ["dnf install -y podman podman-compose"],
    arch: ["pacman -Sy --noconfirm podman podman-compose"],
    suse: ["zypper --non-interactive install podman podman-compose"],
};

export function getPodmanInstallPlan(family: DistroFamily): string[] {
    return [...PODMAN_INSTALL_COMMANDS[family]];
}

export function buildPkexecArgs(plan: string[]): string[] {
    return ["bash", "-c", plan.join(" && ")];
}
