/**
 * LimaSync - Manages file synchronization between macOS and Lima sandbox
 *
 * This module provides complete isolation by:
 * 1. Copying files from macOS to an isolated Lima directory (~/.claude/sandbox/{sessionId})
 * 2. Running all operations within the isolated directory
 * 3. Syncing changes back to macOS when requested
 *
 * Lifecycle:
 * - Sandbox is created when a conversation starts (first message)
 * - Sandbox persists across multiple messages in the same conversation
 * - Sandbox is deleted when:
 *   - User deletes the conversation
 *   - App is closed/shutdown
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log, logError } from '../utils/logger';

const execAsync = promisify(exec);

const LIMA_INSTANCE_NAME = 'claude-sandbox';

export interface LimaSyncSession {
  sessionId: string;
  macPath: string;              // Original macOS path (e.g., /Users/username/project)
  sandboxPath: string;          // Lima sandbox path (e.g., ~/.claude/sandbox/{sessionId})
  initialized: boolean;
  fileCount?: number;
  totalSize?: number;
  lastSyncTime?: number;        // Last sync timestamp
}

export interface LimaSyncResult {
  success: boolean;
  sandboxPath: string;
  fileCount: number;
  totalSize: number;
  error?: string;
}

// Directories/files to exclude from sync (to improve performance)
const SYNC_EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '*.pyc',
  '.next',
  '.cache',
  'coverage',
  '.nyc_output',
  'venv',
  '.venv',
  'env',
  '.env.local',
  '*.log',
  '.DS_Store',
  'Thumbs.db',
];

// Active sync sessions
const sessions = new Map<string, LimaSyncSession>();

export class LimaSync {

  /**
   * Check if a sandbox session already exists for the given session ID
   */
  static hasSession(sessionId: string): boolean {
    return sessions.has(sessionId);
  }

  /**
   * Get all active session IDs
   */
  static getAllSessionIds(): string[] {
    return Array.from(sessions.keys());
  }

  /**
   * Initialize sync session - copy files from macOS to Lima sandbox
   */
  static async initSync(
    macPath: string,
    sessionId: string
  ): Promise<LimaSyncResult> {
    // Check if session already exists
    if (sessions.has(sessionId)) {
      const existingSession = sessions.get(sessionId)!;
      log(`[LimaSync] Session ${sessionId} already initialized`);

      // Verify sandbox still exists
      try {
        await this.limaExec(`test -d "${existingSession.sandboxPath}"`);
        return {
          success: true,
          sandboxPath: existingSession.sandboxPath,
          fileCount: existingSession.fileCount || 0,
          totalSize: existingSession.totalSize || 0,
        };
      } catch {
        log(`[LimaSync] Sandbox ${existingSession.sandboxPath} no longer exists, reinitializing...`);
        sessions.delete(sessionId);
      }
    }

    log(`[LimaSync] Initializing sync for session ${sessionId}`);
    log(`[LimaSync]   macOS path: ${macPath}`);

    // Get the actual home directory path from Lima
    const homeResult = await this.limaExec('cd ~ && pwd');
    const homeDir = homeResult.stdout.trim() || '/home/user';
    const sandboxPath = `${homeDir}/.claude/sandbox/${sessionId}`;
    log(`[LimaSync]   Sandbox path: ${sandboxPath}`);

    try {
      // Create sandbox directory
      await this.limaExec(`mkdir -p "${sandboxPath}"`);

      // Lima mounts /Users at /Users, so paths are the same
      const limaSourcePath = macPath;
      log(`[LimaSync]   Lima source path: ${limaSourcePath}`);

      // Build rsync exclude arguments
      const excludeArgs = SYNC_EXCLUDES.map(e => `--exclude="${e}"`).join(' ');

      // Sync files from macOS to sandbox (within Lima VM)
      const rsyncCmd = `rsync -av --delete ${excludeArgs} "${limaSourcePath}/" "${sandboxPath}/"`;
      log(`[LimaSync] Running: ${rsyncCmd}`);

      await this.limaExec(rsyncCmd, 300000); // 5 min timeout

      // Count files and get size
      const countResult = await this.limaExec(`find "${sandboxPath}" -type f | wc -l`);
      const sizeResult = await this.limaExec(`du -sb "${sandboxPath}" | cut -f1`);

      const fileCount = parseInt(countResult.stdout.trim()) || 0;
      const totalSize = parseInt(sizeResult.stdout.trim()) || 0;

      // Store session info
      const session: LimaSyncSession = {
        sessionId,
        macPath,
        sandboxPath,
        initialized: true,
        fileCount,
        totalSize,
        lastSyncTime: Date.now(),
      };
      sessions.set(sessionId, session);

      log(`[LimaSync] Sync complete: ${fileCount} files, ${this.formatSize(totalSize)}`);

      return {
        success: true,
        sandboxPath,
        fileCount,
        totalSize,
      };
    } catch (error) {
      logError('[LimaSync] Init sync failed:', error);
      return {
        success: false,
        sandboxPath,
        fileCount: 0,
        totalSize: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Sync changes from sandbox back to macOS (without cleanup)
   * Called after each message to persist changes while keeping sandbox alive
   */
  static async syncToMac(sessionId: string): Promise<LimaSyncResult> {
    const session = sessions.get(sessionId);
    if (!session) {
      logError(`[LimaSync] Session not found: ${sessionId}`);
      return {
        success: false,
        sandboxPath: '',
        fileCount: 0,
        totalSize: 0,
        error: 'Session not found',
      };
    }

    log(`[LimaSync] Syncing to macOS for session ${sessionId}`);
    log(`[LimaSync]   Sandbox: ${session.sandboxPath}`);
    log(`[LimaSync]   macOS: ${session.macPath}`);

    try {
      const limaDestPath = session.macPath;

      // Build rsync exclude arguments
      const excludeArgs = SYNC_EXCLUDES.map(e => `--exclude="${e}"`).join(' ');

      // Sync back to macOS (Lima mounts /Users directly)
      // NOTE: We use --delete to ensure files deleted/moved in sandbox are also deleted locally
      // This is important for file organization tasks where files are moved to new locations
      const rsyncCmd = `rsync -av --delete ${excludeArgs} "${session.sandboxPath}/" "${limaDestPath}/"`;
      log(`[LimaSync] Running: ${rsyncCmd}`);

      await this.limaExec(rsyncCmd, 300000); // 5 min timeout

      // Update sync time
      session.lastSyncTime = Date.now();

      log(`[LimaSync] Sync to macOS complete`);

      return {
        success: true,
        sandboxPath: session.sandboxPath,
        fileCount: session.fileCount || 0,
        totalSize: session.totalSize || 0,
      };
    } catch (error) {
      logError('[LimaSync] Sync to macOS failed:', error);
      return {
        success: false,
        sandboxPath: session.sandboxPath,
        fileCount: 0,
        totalSize: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cleanup sandbox for a session (sync back first, then delete)
   */
  static async cleanup(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) {
      log(`[LimaSync] Session ${sessionId} not found, nothing to cleanup`);
      return;
    }

    log(`[LimaSync] Cleaning up session ${sessionId}`);

    try {
      // First sync back to macOS
      await this.syncToMac(sessionId);

      // Then delete sandbox directory
      await this.limaExec(`rm -rf "${session.sandboxPath}"`);
      log(`[LimaSync] Sandbox deleted: ${session.sandboxPath}`);
    } catch (error) {
      logError(`[LimaSync] Cleanup error:`, error);
    } finally {
      sessions.delete(sessionId);
    }
  }

  /**
   * Copy a single file to sandbox
   * Used for file attachments after sandbox is already initialized
   */
  static async syncFileToSandbox(
    sessionId: string,
    macSourcePath: string,
    sandboxRelativePath: string
  ): Promise<{ success: boolean; sandboxPath: string; error?: string }> {
    const session = sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sandboxPath: '',
        error: 'Session not found',
      };
    }

    const sandboxDestPath = `${session.sandboxPath}/${sandboxRelativePath}`;
    log(`[LimaSync] Syncing file to sandbox: ${macSourcePath} -> ${sandboxDestPath}`);

    try {
      const destDir = sandboxDestPath.substring(0, sandboxDestPath.lastIndexOf('/'));

      // Create parent directory
      await this.limaExec(`mkdir -p "${destDir}"`);

      // Copy file (Lima mounts /Users directly)
      const cpCmd = `cp "${macSourcePath}" "${sandboxDestPath}"`;
      log(`[LimaSync] Running: ${cpCmd}`);

      await this.limaExec(cpCmd, 60000); // 1 min timeout

      log(`[LimaSync] File synced to sandbox: ${sandboxDestPath}`);

      return {
        success: true,
        sandboxPath: sandboxDestPath,
      };
    } catch (error) {
      logError('[LimaSync] File sync failed:', error);
      return {
        success: false,
        sandboxPath: sandboxDestPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Copy a single file to sandbox (deprecated - use syncFileToSandbox instead)
   */
  static async copyFileToSandbox(
    sessionId: string,
    macPath: string,
    relativePath: string
  ): Promise<boolean> {
    const result = await this.syncFileToSandbox(sessionId, macPath, relativePath);
    return result.success;
  }

  /**
   * Get the sandbox path for a session (if initialized)
   */
  static getSandboxPath(sessionId: string): string | null {
    const session = sessions.get(sessionId);
    return session?.sandboxPath || null;
  }

  /**
   * Get session info
   */
  static getSession(sessionId: string): LimaSyncSession | undefined {
    return sessions.get(sessionId);
  }

  /**
   * Cleanup all active sandbox sessions
   * Called on app shutdown
   */
  static async cleanupAllSessions(): Promise<void> {
    const sessionIds = Array.from(sessions.keys());

    if (sessionIds.length === 0) {
      log('[LimaSync] No active sessions to cleanup');
      return;
    }

    log(`[LimaSync] Cleaning up ${sessionIds.length} active session(s)...`);

    // Sync and cleanup all sessions in parallel
    const results = await Promise.allSettled(
      sessionIds.map(id => this.cleanup(id))
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    log(`[LimaSync] Cleanup complete: ${succeeded} succeeded, ${failed} failed`);
  }

  /**
   * Clear all session mappings without syncing or cleanup
   * Used when workingDir changes - no need to preserve old sandbox data
   */
  static clearAllSessions(): void {
    const count = sessions.size;
    if (count === 0) {
      log('[LimaSync] No sessions to clear');
      return;
    }
    sessions.clear();
    log(`[LimaSync] Cleared ${count} session(s) from map`);
  }

  /**
   * Clear a specific session mapping without syncing or cleanup
   * Used when a session's workingDir changes
   */
  static clearSession(sessionId: string): void {
    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      log(`[LimaSync] Cleared session ${sessionId} from map`);
    }
  }

  /**
   * Check if a path is within the sandbox
   */
  static isPathInSandbox(path: string, sessionId: string): boolean {
    const session = sessions.get(sessionId);
    if (!session) return false;
    return path.startsWith(session.sandboxPath);
  }

  /**
   * Convert a macOS path to its sandbox equivalent
   */
  static macToSandboxPath(macPath: string, sessionId: string): string | null {
    const session = sessions.get(sessionId);
    if (!session) return null;

    // Normalize paths
    const normalizedMac = session.macPath;
    const normalizedInput = macPath;

    if (normalizedInput.startsWith(normalizedMac)) {
      const relativePath = macPath.substring(session.macPath.length);
      return session.sandboxPath + relativePath;
    }

    return null;
  }

  /**
   * Convert a sandbox path to its macOS equivalent
   */
  static sandboxToMacPath(sandboxPath: string, sessionId: string): string | null {
    const session = sessions.get(sessionId);
    if (!session) return null;

    if (sandboxPath.startsWith(session.sandboxPath)) {
      const relativePath = sandboxPath.substring(session.sandboxPath.length);
      return session.macPath + relativePath;
    }

    return null;
  }

  /**
   * Execute command in Lima VM
   */
  private static async limaExec(
    command: string,
    timeout: number = 60000
  ): Promise<{ stdout: string; stderr: string }> {
    const wrappedCommand = `limactl shell ${LIMA_INSTANCE_NAME} -- bash -c '${command.replace(/'/g, "'\\''")}'`;

    try {
      const result = await execAsync(wrappedCommand, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      });

      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    } catch (error: any) {
      // If command failed, error contains stdout/stderr
      throw new Error(error.message || String(error));
    }
  }

  /**
   * Format bytes to human-readable size
   */
  private static formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
  }
}
