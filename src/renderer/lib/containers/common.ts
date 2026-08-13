import { DockerContainer, DockerSpecs } from "./docker";
import { PodmanContainer, PodmanSpecs } from "./podman";
import { IncusContainer, IncusSpecs } from "./incus";

// For convenience
export { type DockerSpecs } from "./docker";
export { type PodmanSpecs } from "./podman";
export { type IncusSpecs } from "./incus";
export { ContainerStatus } from "./container";

export enum ContainerRuntimes {
    DOCKER = "Docker",
    PODMAN = "Podman",
    INCUS = "Incus",
}

export const ContainerImplementations = {
    [ContainerRuntimes.DOCKER]: DockerContainer,
    [ContainerRuntimes.PODMAN]: PodmanContainer,
    [ContainerRuntimes.INCUS]: IncusContainer,
} as const satisfies Record<ContainerRuntimes, any>; // this makes it so ContainerImplementations has to map ContainerRuntimes to something exhaustively

type ContainerSpecMap = {
    [ContainerRuntimes.DOCKER]: DockerSpecs;
    [ContainerRuntimes.PODMAN]: PodmanSpecs;
    [ContainerRuntimes.INCUS]: IncusSpecs;
};

export type ContainerSpecs = ContainerSpecMap[ContainerRuntimes];

export async function getContainerSpecs<T extends ContainerRuntimes>(type: T): Promise<ContainerSpecMap[T]> {
    return (await ContainerImplementations[type]._getSpecs()) as ContainerSpecMap[T];
}

export function createContainer<T extends ContainerRuntimes>(
    type: T,
    ...params: ConstructorParameters<(typeof ContainerImplementations)[T]>
) {
    return new ContainerImplementations[type](...(params as []));
}
