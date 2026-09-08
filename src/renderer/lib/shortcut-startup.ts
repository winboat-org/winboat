export class GuestServiceError extends Error {}
export class GuestTimeout extends GuestServiceError {}
export class ContainerStopped extends Error {}
export class ContainerStatusTimeout extends Error {
    constructor() {
        super("Couldn’t determine Windows’ status.");
    }
}

type StartupStatus = "ready" | "waiting" | "updating" | "stopped" | "unknown";

export function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", abort, { once: true });
        operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

export async function waitForStartup(
    check: () => Promise<StartupStatus>,
    signal: AbortSignal,
    progress: (status: "waiting" | "updating" | "unknown") => void,
    timeout = 60_000,
    interval = 500,
) {
    const deadline = Date.now() + timeout;
    const deadlineSignal = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
    let status: StartupStatus = "unknown";
    const timeoutError = () => (status === "unknown" ? new ContainerStatusTimeout() : new GuestTimeout());
    while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (deadlineSignal.aborted) throw timeoutError();
        status = await withAbort(check(), deadlineSignal).catch(error => {
            if (!signal.aborted && deadlineSignal.aborted) throw timeoutError();
            throw error;
        });
        if (status === "stopped") throw new ContainerStopped();
        if (status === "ready") return;
        progress(status);
        await new Promise(resolve => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))));
    }
    signal.throwIfAborted();
    throw timeoutError();
}
