import {
    COMPOSE_PORT_MAPPINGS,
    GUEST_API_PORT,
    GUEST_NOVNC_PORT,
    GUEST_QMP_PORT,
    GUEST_RDP_PORT,
    GUEST_UPDATE_PORT,
    HOST_API_PORT,
} from "../lib/constants";

/** Guest ports WinBoat manages itself. Anything else in a compose file is the user's own. */
const MANAGED_GUEST_PORTS = [
    GUEST_NOVNC_PORT,
    GUEST_API_PORT,
    GUEST_QMP_PORT,
    GUEST_UPDATE_PORT,
    GUEST_RDP_PORT,
].map(String);

/** Pulls the guest-side port out of a compose mapping, e.g. "127.0.0.1:47280-47289:7148/tcp" -> "7148" */
export function guestPortOf(mapping: string): string {
    return mapping.split("/")[0].split(":").pop() ?? "";
}

/** True once the Guest Server API is published on the fixed port the app actually dials. */
export function hasFixedHostPorts(ports: string[]): boolean {
    return ports.some(
        mapping => guestPortOf(mapping) === String(GUEST_API_PORT) && mapping.includes(`:${HOST_API_PORT}:`),
    );
}

/**
 * Swaps WinBoat's own mappings for the fixed ones, leaving any port the user
 * added themselves untouched.
 */
export function withFixedHostPorts(ports: string[]): string[] {
    const userDefined = ports.filter(mapping => !MANAGED_GUEST_PORTS.includes(guestPortOf(mapping)));
    return [...COMPOSE_PORT_MAPPINGS, ...userDefined];
}
