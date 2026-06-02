export interface WorkspaceDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface Workspace {
  resolvePath(targetPath: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<WorkspaceDirEntry[]>;
}
