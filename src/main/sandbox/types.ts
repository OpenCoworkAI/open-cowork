/**
 * Sandbox Types - Shared types for sandbox execution
 */

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

export interface SandboxConfig {
  workspacePath: string;           // Windows path like D:\project
  wslWorkspacePath?: string;       // WSL path like /mnt/d/project
  timeout?: number;                // Command timeout in ms
  env?: Record<string, string>;    // Additional environment variables
}

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface WSLStatus {
  available: boolean;
  distro?: string;
  nodeAvailable?: boolean;
  pythonAvailable?: boolean;
  pipAvailable?: boolean;
  claudeCodeAvailable?: boolean;
  version?: string;
  pythonVersion?: string;
}

export interface LimaStatus {
  available: boolean;
  instanceExists?: boolean;
  instanceRunning?: boolean;
  instanceName?: string;
  nodeAvailable?: boolean;
  pythonAvailable?: boolean;
  pipAvailable?: boolean;
  claudeCodeAvailable?: boolean;
  version?: string;
  pythonVersion?: string;
}

export interface SandboxExecutor {
  initialize(config: SandboxConfig): Promise<void>;
  executeCommand(command: string, cwd?: string, env?: Record<string, string>): Promise<ExecutionResult>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  listDirectory(dirPath: string): Promise<DirectoryEntry[]>;
  fileExists(filePath: string): Promise<boolean>;
  deleteFile(filePath: string): Promise<void>;
  createDirectory(dirPath: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  shutdown(): Promise<void>;
}

// Path conversion utilities type
export interface PathConverter {
  toWSL(windowsPath: string): string;
  toWindows(wslPath: string): string;
}

