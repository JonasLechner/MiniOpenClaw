import { CliContainerEngine } from "./docker.js";

export class PodmanEngine extends CliContainerEngine {
  constructor() {
    super("podman");
  }
}
