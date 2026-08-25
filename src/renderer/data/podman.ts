import { ComposeConfig } from "../../types";
import { RESTART_ON_FAILURE } from "../lib/constants";

export const PODMAN_DEFAULT_COMPOSE: ComposeConfig = {
    name: "winboat",
    volumes: {
        data: null,
    },
    services: {
        windows: {
            image: "ghcr.io/dockur/windows:6.05",
            container_name: "WinBoat",
            environment: {
                VERSION: "11",
                RAM_SIZE: "4G",
                CPU_CORES: "4",
                DISK_SIZE: "64G",
                USERNAME: "MyWindowsUser",
                PASSWORD: "MyWindowsPassword",
                HOME: "${HOME}",
                LANGUAGE: "English",
                NETWORK: "user",
                USER_PORTS: "7148",
                HOST_PORTS: "7149",
                ARGUMENTS: "-qmp tcp:0.0.0.0:7149,server,wait=off",
            },
            cap_add: ["NET_ADMIN"],
            ports: [
                "127.0.0.1::8006", // VNC Web Interface
                "127.0.0.1::7148", // Winboat Guest Server API
                "127.0.0.1::7149", // QEMU QMP Port
                "127.0.0.1::3389/tcp", // RDP
                "127.0.0.1::3389/udp", // RDP
            ],
            stop_grace_period: "120s",
            restart: RESTART_ON_FAILURE,
            privileged: true,
            volumes: [
                "data:/storage",
                "${HOME}:/shared",
                "./oem:/oem",
            ],
            devices: ["/dev/kvm", "/dev/bus/usb"],
        },
    },
};
