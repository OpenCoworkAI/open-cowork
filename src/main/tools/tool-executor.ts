import * as fs from 'fs';
import * as path from 'path';
import { spawn, exec } from 'child_process';
import { glob } from 'glob';
import { PathResolver } from '../sandbox/path-resolver';
import type { ToolResult, ExecutionContext, MountedPath } from '../../renderer/types';

/**
 * ToolExecutor - Secure tool execution framework
 * 
 * All file operations go through PathResolver for security validation.
 */
export class ToolExecutor {
  private pathResolver: PathResolver;

  constructor(pathResolver: PathResolver) {
    this.pathResolver = pathResolver;
  }

  /**
   * Resolve a user-provided path to a real path within the mounted workspace.
   * Accepts virtual paths (/mnt/...), absolute paths inside a mount, or
   * relative paths (treated as relative to the first mount root).
   */
  private resolveWorkspacePath(sessionId: string, inputPath: string): string {
    const mounts = this.pathResolver.getMounts(sessionId);
    if (!mounts.length) {
      throw new Error('No mounted workspace for this session');
    }

    const primaryMount = mounts[0];
    const normalizedPrimary = path.normalize(primaryMount.real);
    const trimmed = inputPath.trim();

    // If virtual (/mnt/...), resolve via PathResolver
    if (trimmed.startsWith('/')) {
      const resolved = this.pathResolver.resolve(sessionId, trimmed);
      if (!resolved) {
        throw new Error('Invalid or unauthorized path');
      }
      return this.assertInsideMount(resolved, mounts);
    }

    // If absolute real path, ensure it lies within a mount
    const isAbsolute = path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed);
    if (isAbsolute) {
      const absolutePath = path.normalize(trimmed);
      return this.assertInsideMount(absolutePath, mounts);
    }

    // Relative path: join to primary mount root
    const candidate = path.normalize(path.join(normalizedPrimary, trimmed || '.'));
    return this.assertInsideMount(candidate, mounts);
  }

  /**
   * Ensure a path is inside at least one mount and guard against traversal/symlink escapes.
   */
  private assertInsideMount(targetPath: string, mounts: MountedPath[]): string {
    const normalizedTarget = path.normalize(targetPath);

    // Symlink resolve if exists
    const realPath = fs.existsSync(normalizedTarget)
      ? fs.realpathSync(normalizedTarget)
      : normalizedTarget;

    const allowed = mounts.some((m) => {
      const mountRoot = path.normalize(m.real);
      return realPath.startsWith(mountRoot);
    });

    if (!allowed) {
      throw new Error('Path is outside the mounted workspace');
    }

    return realPath;
  }

  /**
   * Read file contents - Public method for agent-runner
   */
  async readFile(sessionId: string, filePath: string): Promise<string> {
    try {
      const pathToRead = this.resolveWorkspacePath(sessionId, filePath);

      if (!fs.existsSync(pathToRead)) {
        throw new Error(`File not found: ${filePath}`);
      }

      return fs.readFileSync(pathToRead, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Write file contents - Public method for agent-runner
   */
  async writeFile(sessionId: string, filePath: string, content: string): Promise<void> {
    try {
      const pathToWrite = this.resolveWorkspacePath(sessionId, filePath);

      // Ensure directory exists
      const dir = path.dirname(pathToWrite);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(pathToWrite, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List directory contents - Public method for agent-runner
   */
  async listDirectory(sessionId: string, dirPath: string): Promise<string> {
    try {
      const pathToList = this.resolveWorkspacePath(sessionId, dirPath);

      if (!fs.existsSync(pathToList)) {
        throw new Error(`Directory not found: ${dirPath}`);
      }

      const entries = fs.readdirSync(pathToList, { withFileTypes: true });
      const result: string[] = [];

      for (const entry of entries) {
        const prefix = entry.isDirectory() ? '[DIR]' : '[FILE]';
        const size = entry.isFile() 
          ? ` (${this.formatSize(fs.statSync(path.join(pathToList, entry.name)).size)})`
          : '';
        result.push(`${prefix} ${entry.name}${size}`);
      }
      
      return result.length > 0 ? result.join('\n') : 'Directory is empty';
    } catch (error) {
      throw new Error(`Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that a command does not escape the sandbox.
   * - Blocks absolute paths outside mounts
   * - Blocks path traversal (..)
   * - Validates cwd is inside mount
   */
  private validateCommandSandbox(sessionId: string, command: string, cwd: string): void {
    const mounts = this.pathResolver.getMounts(sessionId);
    if (!mounts.length) {
      throw new Error('No mounted workspace for this session');
    }

    // Validate cwd is inside a mount
    const normalizedCwd = path.normalize(cwd);
    const cwdAllowed = mounts.some((m) => {
      const mountRoot = path.normalize(m.real);
      return normalizedCwd.startsWith(mountRoot) || normalizedCwd === mountRoot.replace(/[\\\/]+$/, '');
    });
    if (!cwdAllowed) {
      throw new Error('Working directory is outside the mounted workspace');
    }

    // Block path traversal attempts
    if (/(?:^|[\s;|&])\.\.(?:[\s;|&\/\\]|$)/.test(command) || command.includes('../') || command.includes('..\\')) {
      throw new Error('Command blocked: path traversal (..) is not allowed');
    }

    // Extract potential paths from command (quoted strings and unquoted tokens)
    const pathPatterns = [
      // Windows absolute paths: C:\... or C:/...
      /[A-Za-z]:[\\\/][^\s;|&"'<>]*/g,
      // Unix absolute paths: /...
      /(?:^|[\s;|&"'])\/[^\s;|&"'<>]+/g,
      // Quoted paths
      /"([^"]+)"/g,
      /'([^']+)'/g,
    ];

    const extractedPaths: string[] = [];
    for (const pattern of pathPatterns) {
      let match;
      const testStr = command;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(testStr)) !== null) {
        const p = match[1] || match[0];
        const trimmed = p.trim().replace(/^["'\s]+|["'\s]+$/g, '');
        if (trimmed) extractedPaths.push(trimmed);
      }
    }

    // Validate each extracted path
    for (const p of extractedPaths) {
      const isAbsolute = path.isAbsolute(p) || /^[A-Za-z]:/.test(p);
      if (!isAbsolute) continue; // Relative paths are fine (confined by cwd)

      const normalizedPath = path.normalize(p);
      const allowed = mounts.some((m) => {
        const mountRoot = path.normalize(m.real);
        return normalizedPath.startsWith(mountRoot);
      });

      if (!allowed) {
        throw new Error(`Command blocked: path "${p}" is outside the mounted workspace`);
      }
    }

    // Block dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf?\s+[\/~]/i,
      /dd\s+if=/i,
      /mkfs/i,
      />\s*\/dev\//i,
      /curl.*\|\s*(?:ba)?sh/i,
      /wget.*\|\s*(?:ba)?sh/i,
      /sudo\s/i,
      /format\s+[A-Za-z]:/i,
      /del\s+\/[sfq]/i,
      /rmdir\s+\/[sq]/i,
      /reg\s+(add|delete)/i,
      /net\s+(user|localgroup)/i,
      /powershell\s+.*-enc/i,
      /Set-ExecutionPolicy/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error('Command blocked: potentially dangerous operation');
      }
    }
  }

  /**
   * Execute shell command - Public method for agent-runner
   */
  async executeCommand(sessionId: string, command: string, cwd: string): Promise<string> {
    // Sandbox validation
    this.validateCommandSandbox(sessionId, command, cwd);

    return new Promise((resolve, reject) => {
      // On Windows prefer PowerShell with UTF-8 codepage to reduce quoting/encoding issues
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const args = isWindows
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `chcp 65001 > $null; ${command}`]
        : ['-c', command];

      const proc = spawn(shell, args, {
        cwd,
        env: { ...process.env },
        timeout: 60000, // 60 second timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Command failed: ${error.message}`));
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout || 'Command completed successfully');
        } else {
          reject(new Error(stderr || `Command exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Search files - Public method for agent-runner
   */
  async searchFiles(
    sessionId: string,
    pattern: string,
    searchPath: string,
    contentSearch: boolean
  ): Promise<string> {
    try {
      const pathToSearch = this.resolveWorkspacePath(sessionId, searchPath || '.');

      if (!fs.existsSync(pathToSearch)) {
        throw new Error(`Path not found: ${searchPath}`);
      }

      if (contentSearch) {
        // Search file contents
        const results: string[] = [];
        const regex = new RegExp(pattern, 'gi');
        await this.searchDirectoryContents(pathToSearch, regex, results);
        return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found';
      } else {
        // Search file names
        const files = await glob(pattern, {
          cwd: pathToSearch,
          nodir: false,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });
        return files.length > 0 ? files.slice(0, 100).join('\n') : 'No files found';
      }
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Edit file - search and replace
   */
  async editFile(
    sessionId: string,
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<void> {
    try {
      const resolvedPath = this.resolveWorkspacePath(sessionId, filePath);
      
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(resolvedPath, 'utf-8');
      
      if (!content.includes(oldString)) {
        throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
      }

      const newContent = content.replace(oldString, newString);
      fs.writeFileSync(resolvedPath, newContent, 'utf-8');
    } catch (error) {
      throw new Error(`Edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Glob - find files by pattern
   */
  async glob(
    sessionId: string,
    pattern: string,
    searchPath: string
  ): Promise<string> {
    try {
      const pathToSearch = this.resolveWorkspacePath(sessionId, searchPath || '.');

      if (!fs.existsSync(pathToSearch)) {
        throw new Error(`Path not found: ${searchPath}`);
      }

      const files = await glob(pattern, {
        cwd: pathToSearch,
        nodir: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      
      return files.length > 0 ? files.slice(0, 100).join('\n') : 'No files found';
    } catch (error) {
      throw new Error(`Glob failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Grep - search file contents with regex
   */
  async grep(
    sessionId: string,
    pattern: string,
    searchPath: string
  ): Promise<string> {
    try {
      const pathToSearch = this.resolveWorkspacePath(sessionId, searchPath || '.');

      if (!fs.existsSync(pathToSearch)) {
        throw new Error(`Path not found: ${searchPath}`);
      }

      const results: string[] = [];
      const regex = new RegExp(pattern, 'gi');
      await this.searchDirectoryContents(pathToSearch, regex, results);
      
      return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found';
    } catch (error) {
      throw new Error(`Grep failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search directory contents recursively
   */
  private async searchDirectoryContents(
    dirPath: string,
    regex: RegExp,
    results: string[],
    maxResults: number = 50
  ): Promise<void> {
    if (results.length >= maxResults) return;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(entry.name)) {
          continue;
        }
        await this.searchDirectoryContents(fullPath, regex, results, maxResults);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h'];
        
        if (!textExtensions.includes(ext) && ext !== '') continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            if (results.length < maxResults && regex.test(line)) {
              results.push(`${fullPath}:${index + 1}: ${line.trim().slice(0, 100)}`);
            }
            regex.lastIndex = 0;
          });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Execute a tool with the given input (legacy method)
   */
  async execute(
    tool: string,
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    switch (tool) {
      case 'read':
        return this.read(input.path as string, context);
      case 'write':
        return this.write(input.path as string, input.content as string, context);
      case 'edit':
        return this.edit(
          input.path as string,
          input.old_string as string,
          input.new_string as string,
          context
        );
      case 'glob':
        return this.globSearch(input.pattern as string, context);
      case 'grep':
        return this.grepLegacy(
          input.pattern as string,
          input.path as string | undefined,
          context
        );
      case 'bash':
        return this.bash(input.command as string, context);
      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }
  }

  /**
   * Read file contents (legacy)
   */
  private async read(
    virtualPath: string,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const realPath = this.pathResolver.resolve(context.sessionId, virtualPath);
      if (!realPath) {
        return { success: false, error: 'Invalid or unauthorized path' };
      }

      const content = fs.readFileSync(realPath, 'utf-8');
      return { success: true, output: content };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Read failed',
      };
    }
  }

  /**
   * Write file contents (legacy)
   */
  private async write(
    virtualPath: string,
    content: string,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const realPath = this.pathResolver.resolve(context.sessionId, virtualPath);
      if (!realPath) {
        return { success: false, error: 'Invalid or unauthorized path' };
      }

      const dir = path.dirname(realPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(realPath, content, 'utf-8');
      return { success: true, output: `File written: ${virtualPath}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Write failed',
      };
    }
  }

  /**
   * Edit file with string replacement (legacy)
   */
  private async edit(
    virtualPath: string,
    oldString: string,
    newString: string,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const realPath = this.pathResolver.resolve(context.sessionId, virtualPath);
      if (!realPath) {
        return { success: false, error: 'Invalid or unauthorized path' };
      }

      const content = fs.readFileSync(realPath, 'utf-8');
      
      if (!content.includes(oldString)) {
        return { success: false, error: 'Old string not found in file' };
      }

      const newContent = content.replace(oldString, newString);
      fs.writeFileSync(realPath, newContent, 'utf-8');

      return { success: true, output: `File edited: ${virtualPath}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Edit failed',
      };
    }
  }

  /**
   * Search for files matching a pattern (legacy)
   */
  private async globSearch(
    pattern: string,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const mounts = this.pathResolver.getMounts(context.sessionId);
      if (mounts.length === 0) {
        return { success: false, error: 'No mounted directories' };
      }

      const allFiles: string[] = [];

      for (const mount of mounts) {
        const files = await glob(pattern, {
          cwd: mount.real,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        for (const file of files) {
          const virtualPath = path.posix.join(mount.virtual, file);
          allFiles.push(virtualPath);
        }
      }

      return {
        success: true,
        output: allFiles.length > 0 ? allFiles.join('\n') : 'No files found',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Glob failed',
      };
    }
  }

  /**
   * Search file contents with regex (legacy internal)
   */
  private async grepLegacy(
    pattern: string,
    virtualPath: string | undefined,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const mounts = this.pathResolver.getMounts(context.sessionId);
      if (mounts.length === 0) {
        return { success: false, error: 'No mounted directories' };
      }

      const regex = new RegExp(pattern, 'gm');
      const results: string[] = [];

      if (virtualPath) {
        const realPath = this.pathResolver.resolve(context.sessionId, virtualPath);
        if (!realPath || !fs.existsSync(realPath)) {
          return { success: false, error: 'File not found' };
        }

        const content = fs.readFileSync(realPath, 'utf-8');
        const lines = content.split('\n');
        
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            results.push(`${virtualPath}:${index + 1}:${line}`);
          }
          regex.lastIndex = 0;
        });
      } else {
        for (const mount of mounts) {
          await this.searchDirectoryContents(mount.real, regex, results);
        }
      }

      return {
        success: true,
        output: results.length > 0 ? results.slice(0, 100).join('\n') : 'No matches found',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Grep failed',
      };
    }
  }

  /**
   * Execute a bash command (legacy)
   */
  private async bash(
    command: string,
    context: ExecutionContext
  ): Promise<ToolResult> {
    const cwd = context.cwd || process.cwd();

    // Use the same sandbox validation as executeCommand
    try {
      this.validateCommandSandbox(context.sessionId, command, cwd);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Sandbox validation failed' };
    }

    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      const args = isWindows
        ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `chcp 65001 > $null; ${command}`]
        : ['-c', command];

      const proc = spawn(shell, args, {
        cwd,
        env: { ...process.env },
        timeout: 30000,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({ success: false, error: error.message });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout || 'Command completed' });
        } else {
          resolve({
            success: false,
            error: stderr || `Command exited with code ${code}`,
          });
        }
      });
    });
  }
}
