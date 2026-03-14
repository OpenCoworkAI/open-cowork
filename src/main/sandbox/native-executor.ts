/**
 * Native Executor - Direct execution for Mac/Linux
 * 
 * On non-Windows platforms, we execute commands directly on the host.
 * This provides the same interface as WSLBridge but without WSL isolation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { log } from '../utils/logger';
import { isPathWithinRoot } from '../tools/path-containment';
import type {
  SandboxConfig,
  SandboxExecutor,
  ExecutionResult,
  DirectoryEntry,
} from './types';

/**
 * Native Executor - Runs commands directly on the host system
 */
export class NativeExecutor implements SandboxExecutor {
  private config: SandboxConfig | null = null;
  private workspacePath: string = '';
  private isInitialized: boolean = false;

  /**
   * Initialize the executor with workspace configuration
   */
  async initialize(config: SandboxConfig): Promise<void> {
    this.config = config;
    this.workspacePath = path.resolve(config.workspacePath);
    
    // Verify workspace exists
    if (!fs.existsSync(this.workspacePath)) {
      throw new Error(`Workspace does not exist: ${this.workspacePath}`);
    }

    this.isInitialized = true;
    log('[NativeExecutor] Initialized with workspace:', this.workspacePath);
  }

  /**
   * Validate that a path is within the workspace
   */
  private validatePath(targetPath: string): string {
    if (!this.workspacePath) {
      throw new Error('Executor not initialized');
    }

    const resolved = path.resolve(targetPath);
    const normalizedWorkspace = path.normalize(this.workspacePath);
    const normalizedTarget = path.normalize(resolved);

    // Handle case-insensitive comparison on Windows
    const isWindows = process.platform === 'win32';
    const workspaceCheck = isWindows 
      ? normalizedWorkspace.toLowerCase() 
      : normalizedWorkspace;
    const targetCheck = isWindows 
      ? normalizedTarget.toLowerCase() 
      : normalizedTarget;

    if (!isPathWithinRoot(targetCheck, workspaceCheck, isWindows)) {
      throw new Error(`Path is outside workspace: ${resolved}`);
    }

    // Check for symlink escapes
    if (fs.existsSync(resolved)) {
      const realPath = fs.realpathSync(resolved);
      const realCheck = isWindows ? realPath.toLowerCase() : realPath;
      if (!isPathWithinRoot(realCheck, workspaceCheck, isWindows)) {
        throw new Error(`Symlink escape detected: ${resolved} -> ${realPath}`);
      }
    }

    return resolved;
  }

  /**
   * Validate command for dangerous patterns
   */
  private validateCommand(command: string, cwd: string): void {
    // Validate cwd
    this.validatePath(cwd);

    // Block path traversal
    if (/(?:^|[\s;|&])\.\.(?:[\s;|&\/\\]|$)/.test(command)) {
      throw new Error('Path traversal detected in command');
    }

    // Block dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf?\s+[\/~]/i,
      /dd\s+if=/i,
      /mkfs/i,
      />\s*\/dev\//i,
      /curl.*\|\s*(?:ba)?sh/i,
      /wget.*\|\s*(?:ba)?sh/i,
    ];

    if (process.platform === 'win32') {
      dangerousPatterns.push(
        /format\s+[A-Za-z]:/i,
        /del\s+\/[sfq]/i,
        /rmdir\s+\/[sq]/i,
        /reg\s+(add|delete)/i,
        /net\s+(user|localgroup)/i,
        /powershell\s+.*-enc/i,
        /Set-ExecutionPolicy/i,
      );
    }

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error('Potentially dangerous command blocked');
      }
    }
  }

  /**
   * Execute a shell command
   */
  async executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>
  ): Promise<ExecutionResult> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const workDir = cwd ? this.validatePath(cwd) : this.workspacePath;
    this.validateCommand(command, workDir);

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const args = isWindows
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-c', command];

      const proc = spawn(shell, args, {
        cwd: workDir,
        env: {
          ...process.env,
          ...env,
          WORKSPACE: this.workspacePath,
        },
        timeout: this.config?.timeout || 60000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error: Error) => {
        resolve({
          success: false,
          stdout: '',
          stderr: error.message,
          exitCode: 1,
        });
      });

      proc.on('close', (code: number | null) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }

  /**
   * Read a file
   */
  async readFile(filePath: string): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validPath = this.validatePath(filePath);
    
    if (!fs.existsSync(validPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    return fs.readFileSync(validPath, 'utf-8');
  }

  /**
   * Write a file
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validPath = this.validatePath(filePath);
    
    // Ensure directory exists
    const dir = path.dirname(validPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(validPath, content, 'utf-8');
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string): Promise<DirectoryEntry[]> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validPath = this.validatePath(dirPath);
    
    if (!fs.existsSync(validPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const entries = fs.readdirSync(validPath, { withFileTypes: true });
    
    return entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      size: entry.isFile() 
        ? fs.statSync(path.join(validPath, entry.name)).size 
        : undefined,
    }));
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const validPath = this.validatePath(filePath);
      return fs.existsSync(validPath);
    } catch {
      return false;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validPath = this.validatePath(filePath);
    
    if (fs.existsSync(validPath)) {
      fs.unlinkSync(validPath);
    }
  }

  /**
   * Create a directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validPath = this.validatePath(dirPath);
    
    if (!fs.existsSync(validPath)) {
      fs.mkdirSync(validPath, { recursive: true });
    }
  }

  /**
   * Copy a file
   */
  async copyFile(src: string, dest: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Executor not initialized');
    }

    const validSrc = this.validatePath(src);
    const validDest = this.validatePath(dest);
    
    // Ensure destination directory exists
    const destDir = path.dirname(validDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(validSrc, validDest);
  }

  /**
   * Shutdown the executor
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
    this.config = null;
    log('[NativeExecutor] Shutdown complete');
  }

  /**
   * Check if executor is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
}
