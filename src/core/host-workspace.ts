import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { Workspace, WorkspaceDirEntry } from "./workspace.js";

interface PathApi {
  dirname(filePath: string): string;
  basename(filePath: string): string;
  isAbsolute(filePath: string): boolean;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  sep: string;
}

const defaultPathApi: PathApi = path;

function toAbsolutePath(filePath: string, pathApi: PathApi = defaultPathApi): string {
  return pathApi.resolve(filePath);
}

function resolveFromWorkspace(workspacePath: string, targetPath: string, pathApi: PathApi = defaultPathApi): string {
  return pathApi.resolve(workspacePath, targetPath);
}

export function isWithinWorkspacePath(
  workspacePath: string,
  targetPath: string,
  pathApi: PathApi = defaultPathApi,
): boolean {
  const relativePath = pathApi.relative(workspacePath, targetPath);
  return relativePath === ""
    || (!relativePath.startsWith(`..${pathApi.sep}`) && relativePath !== ".." && !pathApi.isAbsolute(relativePath));
}

async function canonicalizePath(filePath: string): Promise<string> {
  return fs.realpath(filePath);
}

async function resolvePathThroughExistingAncestor(
  targetPath: string,
  pathApi: PathApi = defaultPathApi,
): Promise<string> {
  const missingSegments: string[] = [];
  let currentPath = targetPath;

  while (true) {
    try {
      const canonicalPath = await canonicalizePath(currentPath);
      return pathApi.resolve(canonicalPath, ...missingSegments.reverse());
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }

      const parentPath = pathApi.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }

      missingSegments.push(pathApi.basename(currentPath));
      currentPath = parentPath;
    }
  }
}

export class HostWorkspace implements Workspace {
  readonly #workspacePath: string;

  constructor(workspacePath: string) {
    this.#workspacePath = workspacePath;
  }

  async resolvePath(targetPath: string): Promise<string> {
    const workspacePath = toAbsolutePath(this.#workspacePath);
    const resolvedPath = resolveFromWorkspace(workspacePath, targetPath);
    const canonicalWorkspacePath = await canonicalizePath(workspacePath);
    const canonicalTargetPath = await resolvePathThroughExistingAncestor(resolvedPath);

    if (!isWithinWorkspacePath(canonicalWorkspacePath, canonicalTargetPath)) {
      throw new Error(`path must stay within workspace: ${canonicalWorkspacePath}`);
    }

    return resolvedPath;
  }

  async readFile(targetPath: string): Promise<string> {
    const path = await this.resolvePath(targetPath);
    return fs.readFile(path, "utf8");
  }

  async writeFile(targetPath: string, content: string): Promise<void> {
    const path = await this.resolvePath(targetPath);
    await fs.writeFile(path, content, "utf8");
  }

  async readDir(targetPath: string): Promise<WorkspaceDirEntry[]> {
    const path = await this.resolvePath(targetPath);
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  }
}

export function createHostWorkspace(workspacePath: string): Workspace {
  return new HostWorkspace(workspacePath);
}
