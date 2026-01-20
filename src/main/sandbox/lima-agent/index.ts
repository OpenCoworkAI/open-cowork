#!/usr/bin/env node
/**
 * Lima Sandbox Agent
 *
 * This script runs inside Lima VM and handles:
 * - Command execution in isolated environment
 * - File operations with path validation
 * - Claude-code execution
 *
 * Communication is via stdin/stdout JSON-RPC.
 *
 * NOTE: This is functionally identical to wsl-agent,
 * adapted for Lima on macOS.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

// Types
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
}

// Logging to stderr (stdout is for JSON-RPC)
function log(...args: unknown[]): void {
  console.error('[Lima-Agent]', ...args);
}

function logError(...args: unknown[]): void {
  console.error('[Lima-Agent ERROR]', ...args);
}

/**
 * Lima Sandbox Agent
 */
class SandboxAgent {
  private workspacePath: string = '';
  private macWorkspacePath: string = '';
  private isShuttingDown: boolean = false;

  /**
   * Set the allowed workspace directory
   */
  setWorkspace(limaPath: string, macPath: string): void {
    this.workspacePath = path.resolve(limaPath);
    this.macWorkspacePath = macPath;
    log('Workspace set to:', this.workspacePath);
  }

  /**
   * Validate that a path is within the workspace
   */
  private validatePath(targetPath: string): string {
    if (!this.workspacePath) {
      throw new Error('Workspace not configured');
    }

    const resolved = path.resolve(targetPath);

    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error(`Path is outside workspace: ${resolved}`);
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
    if (command.includes('../') || command.includes('..\\')) {
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
      /sudo\s+rm/i,
      /chmod\s+777\s+\//i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error('Potentially dangerous command blocked');
      }
    }

    // Extract and validate absolute paths in command
    const pathMatches = command.match(/\/[\w\/\-\.]+/g) || [];
    for (const p of pathMatches) {
      // Skip system paths that are commonly used
      if (p.startsWith('/usr/') || p.startsWith('/bin/') ||
          p.startsWith('/tmp/') || p.startsWith('/dev/null')) {
        continue;
      }

      // Check if it's a path in /Users/ (macOS paths mounted by Lima)
      if (p.startsWith('/Users/')) {
        const resolved = path.resolve(p);
        if (!resolved.startsWith(this.workspacePath)) {
          throw new Error(`Command references path outside workspace: ${p}`);
        }
      }
    }
  }

  /**
   * Execute a shell command
   */
  async executeCommand(params: {
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<{ code: number; stdout: string; stderr: string }> {
    const cwd = params.cwd || this.workspacePath;
    const timeout = params.timeout || 60000;

    // Validate command
    this.validateCommand(params.command, cwd);

    log('Executing:', params.command, 'in', cwd);

    return new Promise((resolve, reject) => {
      const proc = spawn('/bin/bash', ['-c', params.command], {
        cwd,
        env: {
          ...process.env,
          ...params.env,
          // Ensure workspace is set
          WORKSPACE: this.workspacePath,
          MAC_WORKSPACE: this.macWorkspacePath,
        },
        timeout,
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
        reject(error);
      });

      proc.on('close', (code: number | null) => {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    });
  }

  /**
   * Read a file
   */
  async readFile(params: { path: string }): Promise<{ content: string }> {
    const validPath = this.validatePath(params.path);

    if (!fs.existsSync(validPath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    const content = fs.readFileSync(validPath, 'utf-8');
    return { content };
  }

  /**
   * Write a file
   */
  async writeFile(params: { path: string; content: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);

    // Ensure directory exists
    const dir = path.dirname(validPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(validPath, params.content, 'utf-8');
    return { success: true };
  }

  /**
   * List directory contents
   */
  async listDirectory(params: { path: string }): Promise<{ entries: DirectoryEntry[] }> {
    const validPath = this.validatePath(params.path);

    if (!fs.existsSync(validPath)) {
      throw new Error(`Directory not found: ${params.path}`);
    }

    const entries = fs.readdirSync(validPath, { withFileTypes: true });

    return {
      entries: entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size: entry.isFile()
          ? fs.statSync(path.join(validPath, entry.name)).size
          : undefined,
      })),
    };
  }

  /**
   * Check if file exists
   */
  async fileExists(params: { path: string }): Promise<{ exists: boolean }> {
    try {
      const validPath = this.validatePath(params.path);
      return { exists: fs.existsSync(validPath) };
    } catch {
      return { exists: false };
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(params: { path: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);

    if (fs.existsSync(validPath)) {
      fs.unlinkSync(validPath);
    }

    return { success: true };
  }

  /**
   * Create a directory
   */
  async createDirectory(params: { path: string }): Promise<{ success: boolean }> {
    const validPath = this.validatePath(params.path);

    if (!fs.existsSync(validPath)) {
      fs.mkdirSync(validPath, { recursive: true });
    }

    return { success: true };
  }

  /**
   * Copy a file
   */
  async copyFile(params: { src: string; dest: string }): Promise<{ success: boolean }> {
    const validSrc = this.validatePath(params.src);
    const validDest = this.validatePath(params.dest);

    // Ensure destination directory exists
    const destDir = path.dirname(validDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(validSrc, validDest);
    return { success: true };
  }

  /**
   * Run claude-code CLI
   */
  async runClaudeCode(params: {
    prompt: string;
    cwd?: string;
    model?: string;
    maxTurns?: number;
    systemPrompt?: string;
    env?: Record<string, string>;
  }): Promise<{ messages: unknown[] }> {
    const cwd = params.cwd || this.workspacePath;
    this.validatePath(cwd);

    log('Running claude-code in:', cwd);

    // Build claude command
    const args = ['--print'];
    if (params.model) {
      args.push('--model', params.model);
    }
    if (params.maxTurns) {
      args.push('--max-turns', String(params.maxTurns));
    }
    args.push(params.prompt);

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        cwd,
        env: {
          ...process.env,
          ...params.env,
        },
        timeout: 300000, // 5 minutes
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      proc.on('error', (error: Error) => {
        reject(error);
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          // Parse output as messages
          try {
            const messages = output
              .split('\n')
              .filter(Boolean)
              .map(line => {
                try {
                  return JSON.parse(line);
                } catch {
                  return { type: 'text', content: line };
                }
              });
            resolve({ messages });
          } catch {
            resolve({ messages: [{ type: 'text', content: output }] });
          }
        } else {
          reject(new Error(`claude-code exited with code ${code}: ${errorOutput}`));
        }
      });
    });
  }

  /**
   * Handle ping request
   */
  ping(): { pong: boolean } {
    return { pong: true };
  }

  /**
   * Handle shutdown request
   */
  shutdown(): { success: boolean } {
    this.isShuttingDown = true;
    log('Shutting down, isShuttingDown:', this.isShuttingDown);
    // Exit after sending response
    setImmediate(() => process.exit(0));
    return { success: true };
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(request: JSONRPCRequest): Promise<unknown> {
    const { method, params } = request;

    switch (method) {
      case 'ping':
        return this.ping();

      case 'setWorkspace':
        this.setWorkspace(
          params.path as string,
          (params.macPath || params.windowsPath) as string  // Support both macPath and windowsPath for compatibility
        );
        return { success: true };

      case 'executeCommand':
        return this.executeCommand(params as Parameters<typeof this.executeCommand>[0]);

      case 'readFile':
        return this.readFile(params as Parameters<typeof this.readFile>[0]);

      case 'writeFile':
        return this.writeFile(params as Parameters<typeof this.writeFile>[0]);

      case 'listDirectory':
        return this.listDirectory(params as Parameters<typeof this.listDirectory>[0]);

      case 'fileExists':
        return this.fileExists(params as Parameters<typeof this.fileExists>[0]);

      case 'deleteFile':
        return this.deleteFile(params as Parameters<typeof this.deleteFile>[0]);

      case 'createDirectory':
        return this.createDirectory(params as Parameters<typeof this.createDirectory>[0]);

      case 'copyFile':
        return this.copyFile(params as Parameters<typeof this.copyFile>[0]);

      case 'runClaudeCode':
        return this.runClaudeCode(params as Parameters<typeof this.runClaudeCode>[0]);

      case 'shutdown':
        return this.shutdown();

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const agent = new SandboxAgent();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  log('Lima Sandbox Agent started');

  // Helper to send JSON-RPC response
  function sendResponse(response: JSONRPCResponse): void {
    console.log(JSON.stringify(response));
  }

  rl.on('line', async (line: string) => {
    if (!line.trim()) return;

    let request: JSONRPCRequest | null = null;

    try {
      request = JSON.parse(line) as JSONRPCRequest;

      // Validate JSON-RPC structure
      if (request.jsonrpc !== '2.0' || !request.id || !request.method) {
        throw new Error('Invalid JSON-RPC request');
      }

      const result = await agent.handleRequest(request);

      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError('Request failed:', errorMessage);

      sendResponse({
        jsonrpc: '2.0',
        id: request?.id || 'unknown',
        error: {
          code: -32000,
          message: errorMessage,
        },
      });
    }
  });

  rl.on('close', () => {
    log('Input stream closed, shutting down');
    process.exit(0);
  });

  // Handle process signals
  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down');
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logError('Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('Unhandled rejection:', reason);
  });
}

// Run the agent
main().catch((error) => {
  console.error('Failed to start Lima agent:', error);
  process.exit(1);
});
