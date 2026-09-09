import { join } from "node:path";

export function bundledFreeRDPPath(paths: {
    isPackaged: boolean;
    resourcesPath: string;
    appPath: string;
    arch: string;
}): string {
    return paths.isPackaged
        ? join(paths.resourcesPath, "freerdp", "xfreerdp")
        : join(paths.appPath, "..", "..", ".cache", "freerdp", `linux-${paths.arch}`, "wbfreerdp", "xfreerdp");
}
