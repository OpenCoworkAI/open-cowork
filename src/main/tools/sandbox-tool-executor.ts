/**
 * Sandbox Tool Executor - Secure tool execution using SandboxAdapter
 * 
 * This executor uses the SandboxAdapter to run commands and file operations
 * in an isolated environment (WSL on Windows, native on Mac/Linux).
 */

import * as path from 'path';
import { glob } from 'glob';
import { SandboxAdapter, getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { PathResolver } from '../sandbox/path-resolver';
// Logger imports removed - using sandbox adapter's internal logging
import type { ToolResult, ExecutionContext, MountedPath } from '../../renderer/types';
import { isUncPath } from '../../shared/local-file-path';
import { isPathWithinRoot } from './path-containment';

/**
 * SandboxToolExecutor - Executes tools through the sandbox
 */
export class SandboxToolExecutor {
  private sandboxAdapter: SandboxAdapter;
  private pathResolver: PathResolver;

  constructor(pathResolver: PathResolver, sandboxAdapter?: SandboxAdapter) {
    this.pathResolver = pathResolver;
    this.sandboxAdapter = sandboxAdapter || getSandboxAdapter();
  }

  /**
   * Resolve a user-provided path to a real path within the mounted workspace.
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
    const isAbsolute = path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed) || isUncPath(trimmed);
    if (isAbsolute) {
      const absolutePath = path.normalize(trimmed);
      return this.assertInsideMount(absolutePath, mounts);
    }

    // Relative path: join to primary mount root
    const candidate = path.normalize(path.join(normalizedPrimary, trimmed || '.'));
    return this.assertInsideMount(candidate, mounts);
  }

  /**
   * Ensure a path is inside at least one mount.
   */
  private assertInsideMount(targetPath: string, mounts: MountedPath[]): string {
    const normalizedTarget = path.normalize(targetPath);
    const isWindows = process.platform === 'win32';

    // Compare paths (case-insensitive on Windows)
    const targetLower = isWindows ? normalizedTarget.toLowerCase() : normalizedTarget;

    const allowed = mounts.some((m) => {
      const mountRoot = path.normalize(m.real);
      return isPathWithinRoot(targetLower, mountRoot, isWindows);
    });

    if (!allowed) {
      throw new Error('Path is outside the mounted workspace');
    }

    return normalizedTarget;
  }

  /**
   * Read file contents using sandbox
   */
  async readFile(sessionId: string, filePath: string): Promise<string> {
    try {
      const pathToRead = this.resolveWorkspacePath(sessionId, filePath);
      return await this.sandboxAdapter.readFile(pathToRead);
    } catch (error) {
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Write file contents using sandbox
   */
  async writeFile(sessionId: string, filePath: string, content: string): Promise<void> {
    try {
      const pathToWrite = this.resolveWorkspacePath(sessionId, filePath);
      
      // Ensure directory exists
      const dir = path.dirname(pathToWrite);
      const dirExists = await this.sandboxAdapter.fileExists(dir);
      if (!dirExists) {
        await this.sandboxAdapter.createDirectory(dir);
      }
      
      await this.sandboxAdapter.writeFile(pathToWrite, content);
    } catch (error) {
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List directory contents using sandbox
   */
  async listDirectory(sessionId: string, dirPath: string): Promise<string> {
    try {
      const pathToList = this.resolveWorkspacePath(sessionId, dirPath);
      const entries = await this.sandboxAdapter.listDirectory(pathToList);

      const result: string[] = [];
      for (const entry of entries) {
        const prefix = entry.isDirectory ? '[DIR]' : '[FILE]';
        const size = !entry.isDirectory && entry.size !== undefined
          ? ` (${this.formatSize(entry.size)})`
          : '';
        result.push(`${prefix} ${entry.name}${size}`);
      }
      
      return result.length > 0 ? result.join('\n') : 'Directory is empty';
    } catch (error) {
      throw new Error(`Failed to list directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute shell command using sandbox
   */
  async executeCommand(sessionId: string, command: string, cwd: string): Promise<string> {
    // Validate cwd is inside workspace
    const resolvedCwd = this.resolveWorkspacePath(sessionId, cwd);

    // Execute in sandbox
    const result = await this.sandboxAdapter.executeCommand(command, resolvedCwd);
    
    if (result.success) {
      return result.stdout || 'Command completed successfully';
    } else {
      throw new Error(result.stderr || `Command exited with code ${result.exitCode}`);
    }
  }

  /**
   * Edit file using search and replace
   */
  async editFile(
    sessionId: string,
    filePath: string,
    oldString: string,
    newString: string
  ): Promise<void> {
    try {
      const resolvedPath = this.resolveWorkspacePath(sessionId, filePath);
      
      const exists = await this.sandboxAdapter.fileExists(resolvedPath);
      if (!exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = await this.sandboxAdapter.readFile(resolvedPath);
      
      if (!content.includes(oldString)) {
        throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
      }

      const newContent = content.replace(oldString, newString);
      await this.sandboxAdapter.writeFile(resolvedPath, newContent);
    } catch (error) {
      throw new Error(`Edit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search files using glob pattern
   */
  async searchFiles(
    sessionId: string,
    pattern: string,
    searchPath: string,
    contentSearch: boolean
  ): Promise<string> {
    try {
      const pathToSearch = this.resolveWorkspacePath(sessionId, searchPath || '.');

      if (contentSearch) {
        // Content search - read files and search
        const results: string[] = [];
        const regex = new RegExp(pattern, 'gi');
        await this.searchDirectoryContents(pathToSearch, regex, results);
        return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found';
      } else {
        // Use glob for filename matching
        // Note: For WSL mode, we run glob on the host side as the sandbox
        // doesn't have glob installed by default
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
   * Glob - find files by pattern
   */
  async glob(
    sessionId: string,
    pattern: string,
    searchPath: string
  ): Promise<string> {
    try {
      const pathToSearch = this.resolveWorkspacePath(sessionId, searchPath || '.');

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

      const results: string[] = [];
      const regex = new RegExp(pattern, 'gi');
      await this.searchDirectoryContents(pathToSearch, regex, results);
      
      return results.length > 0 ? results.slice(0, 50).join('\n') : 'No matches found';
    } catch (error) {
      throw new Error(`Grep failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Web fetch - get URL content
   */
  async webFetch(url: string): Promise<string> {
    const trimmed = url.trim();
    if (!trimmed) {
      throw new Error('URL is required');
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Invalid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http/https URLs are supported');
    }

    const response = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'open-cowork' },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'unknown';
    const body = await response.text();
    const limit = 20000;
    const truncated = body.length > limit
      ? `${body.slice(0, limit)}\n\n[Truncated ${body.length - limit} chars]`
      : body;

    return `URL: ${parsed.toString()}\nStatus: ${response.status}\nContent-Type: ${contentType}\n\n${truncated}`;
  }

  /**
   * Web search using DuckDuckGo
   */
  async webSearch(query: string): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('Query is required');
    }

    const searchUrl = new URL('https://api.duckduckgo.com/');
    searchUrl.searchParams.set('q', trimmed);
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('no_redirect', '1');
    searchUrl.searchParams.set('no_html', '1');
    searchUrl.searchParams.set('skip_disambig', '1');

    const response = await fetch(searchUrl.toString(), {
      headers: { 'User-Agent': 'open-cowork' },
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const heading = typeof data.Heading === 'string' ? data.Heading : '';
    const abstractText = typeof data.AbstractText === 'string' ? data.AbstractText : '';
    const relatedTopics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];

    type TopicItem = { text: string; url?: string };
    const results: TopicItem[] = [];

    const collectTopics = (topic: unknown): void => {
      if (!topic || typeof topic !== 'object') return;
      const record = topic as Record<string, unknown>;
      const text = typeof record.Text === 'string' ? record.Text : '';
      const firstUrl = typeof record.FirstURL === 'string' ? record.FirstURL : '';
      if (text) {
        results.push({ text, url: firstUrl || undefined });
      }
      const nested = Array.isArray(record.Topics) ? record.Topics : [];
      for (const nestedItem of nested) {
        collectTopics(nestedItem);
      }
    };

    for (const topic of relatedTopics) {
      collectTopics(topic);
    }

    const lines: string[] = [];
    lines.push(`Query: ${trimmed}`);
    lines.push('Source: DuckDuckGo Instant Answer');
    if (heading) lines.push(`Heading: ${heading}`);
    if (abstractText) lines.push(`Abstract: ${abstractText}`);

    const topResults = results.slice(0, 5);
    if (topResults.length > 0) {
      lines.push('Results:');
      for (const item of topResults) {
        lines.push(`- ${item.text}${item.url ? ` (${item.url})` : ''}`);
      }
    } else if (!abstractText) {
      lines.push('Results: No related topics found.');
    }

    const output = lines.join('\n');
    const limit = 20000;
    return output.length > limit
      ? `${output.slice(0, limit)}\n\n[Truncated ${output.length - limit} chars]`
      : output;
  }

  /**
   * Search directory contents recursively
   * Note: This reads files through the sandbox for content searching
   */
  private async searchDirectoryContents(
    dirPath: string,
    regex: RegExp,
    results: string[],
    maxResults: number = 50
  ): Promise<void> {
    if (results.length >= maxResults) return;

    try {
      const entries = await this.sandboxAdapter.listDirectory(dirPath);

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory) {
          if (['node_modules', '.git', 'dist', 'build', '__pycache__'].includes(entry.name)) {
            continue;
          }
          await this.searchDirectoryContents(fullPath, regex, results, maxResults);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          const textExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.css', '.html', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h'];
          
          if (!textExtensions.includes(ext) && ext !== '') continue;

          try {
            const content = await this.sandboxAdapter.readFile(fullPath);
            const lines = content.split(/\r?\n/);
            
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
    } catch {
      // Skip directories that can't be listed
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
   * Execute a tool with the given input (legacy interface)
   */
  async execute(
    tool: string,
    input: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    switch (tool) {
      case 'read':
        try {
          const content = await this.readFile(context.sessionId, input.path as string);
          return { success: true, output: content };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Read failed' };
        }

      case 'write':
        try {
          await this.writeFile(context.sessionId, input.path as string, input.content as string);
          return { success: true, output: `File written: ${input.path}` };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Write failed' };
        }

      case 'edit':
        try {
          await this.editFile(
            context.sessionId,
            input.path as string,
            input.old_string as string,
            input.new_string as string
          );
          return { success: true, output: `File edited: ${input.path}` };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Edit failed' };
        }

      case 'glob':
        try {
          const files = await this.glob(context.sessionId, input.pattern as string, '.');
          return { success: true, output: files };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Glob failed' };
        }

      case 'grep':
        try {
          const matches = await this.grep(
            context.sessionId,
            input.pattern as string,
            input.path as string || '.'
          );
          return { success: true, output: matches };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Grep failed' };
        }

      case 'bash':
        try {
          const output = await this.executeCommand(
            context.sessionId,
            input.command as string,
            context.cwd || '.'
          );
          return { success: true, output };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Command failed' };
        }

      default:
        return { success: false, error: `Unknown tool: ${tool}` };
    }
  }

  /**
   * Check if sandbox is using WSL
   */
  get isWSL(): boolean {
    return this.sandboxAdapter.isWSL;
  }

  /**
   * Get sandbox mode
   */
  get mode(): string {
    return this.sandboxAdapter.mode;
  }
}
