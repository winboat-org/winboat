import { ComposeConfig } from "../../types";
import {
    COMPOSE_PORT_MAPPINGS,
    GUEST_API_PORT,
    GUEST_QMP_PORT,
    GUEST_UPDATE_PORT,
    QMP_ARGUMENT,
    RESTART_NO,
} from "../lib/constants";

export const PODMAN_DEFAULT_COMPOSE: ComposeConfig = {
    name: "winboat",
    volumes: {
        data: null,
    },
    services: {
        windows: {
            image: "ghcr.io/dockur/windows:6.03",
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
                USER_PORTS: `${GUEST_API_PORT},${GUEST_UPDATE_PORT}`,
                HOST_PORTS: `${GUEST_QMP_PORT}`,
                ARGUMENTS: QMP_ARGUMENT,
            },
            cap_add: ["NET_ADMIN"],
            ports: [...COMPOSE_PORT_MAPPINGS],
            stop_grace_period: "120s",
            restart: RESTART_NO,
            privileged: true,
            volumes: [
                "data:/storage",
                "${HOME}:/shared",
                "./oem:/oem",
                "/dev:/dev:rslave",
                "/dev/pts:/dev/pts"
            ],
            devices: ["/dev/kvm", "/dev/bus/usb"],
        },
    },
};
