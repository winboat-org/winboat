import { Arch } from "electron-builder";
import { prepareFreeRDP } from "./prepare-freerdp.mjs";

export default async function beforePack(context) {
    if (context.electronPlatformName !== "linux" || context.arch !== Arch.x64) {
        throw new Error("The WinBoat runtime bundles currently support Linux x64 only.");
    }
    await prepareFreeRDP();
}
