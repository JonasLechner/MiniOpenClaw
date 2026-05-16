import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ToolRunContext } from "./types.js";

interface PathApi {
  dirname(filePath: string): string;
  basename(filePath: string): string;
  isAbsolute(filePath: string): boolean;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  sep: string;
}

const defaultPathApi: PathApi = path;

function requireWorkspacePath(context?: ToolRunContext): string {
  if (!context) {
    throw new Error("workspace path is required");
  }

  return context.workspacePath;
}

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

export async function resolveWorkspacePath(targetPath: string, context?: ToolRunContext): Promise<string> {
  const workspacePath = toAbsolutePath(requireWorkspacePath(context));
  const resolvedPath = resolveFromWorkspace(workspacePath, targetPath);
  const canonicalWorkspacePath = await canonicalizePath(workspacePath);
  const canonicalTargetPath = await resolvePathThroughExistingAncestor(resolvedPath);

  if (!isWithinWorkspacePath(canonicalWorkspacePath, canonicalTargetPath)) {
    throw new Error(`path must stay within workspace: ${canonicalWorkspacePath}`);
  }

  return resolvedPath;
}
