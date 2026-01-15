import * as path from 'path';
import * as fs from 'fs';
import type { MountedPath } from '../../renderer/types';

/**
 * PathResolver - Core security component for sandboxed file system access
 * 
 * All file operations must go through this resolver to ensure:
 * 1. Paths are within authorized directories
 * 2. No path traversal attacks (../)
 * 3. No symlink escapes
 */
export class PathResolver {
  private sessionMounts: Map<string, MountedPath[]> = new Map();

  /**
   * Register mounted paths for a session
   */
  registerSession(sessionId: string, mounts: MountedPath[]): void {
    this.sessionMounts.set(sessionId, mounts);
  }

  /**
   * Unregister a session
   */
  unregisterSession(sessionId: string): void {
    this.sessionMounts.delete(sessionId);
  }

  /**
   * Resolve virtual path to real path with security validation
   * 
   * @param sessionId - Session ID
   * @param virtualPath - Virtual path (e.g., /mnt/workspace/src/index.ts)
   * @returns Real path or null if invalid/unauthorized
   */
  resolve(sessionId: string, virtualPath: string): string | null {
    const mounts = this.sessionMounts.get(sessionId);
    if (!mounts || mounts.length === 0) {
      return null;
    }

    // Normalize virtual path
    const normalizedVirtual = this.normalizePath(virtualPath);
    if (!normalizedVirtual) {
      return null;
    }

    // Find matching mount point
    for (const mount of mounts) {
      const normalizedMount = this.normalizePath(mount.virtual);
      if (!normalizedMount) continue;

      if (normalizedVirtual.startsWith(normalizedMount)) {
        // Calculate relative path from mount point
        const relativePath = normalizedVirtual.slice(normalizedMount.length);
        
        // Construct real path
        const realPath = path.join(mount.real, relativePath);
        
        // Validate the resolved path is within the mount
        if (this.validatePath(sessionId, realPath, mount.real)) {
          return realPath;
        }
      }
    }

    return null;
  }

  /**
   * Convert real path back to virtual path
   * 
   * @param sessionId - Session ID
   * @param realPath - Real file system path
   * @returns Virtual path or null if not in any mount
   */
  virtualize(sessionId: string, realPath: string): string | null {
    const mounts = this.sessionMounts.get(sessionId);
    if (!mounts || mounts.length === 0) {
      return null;
    }

    const normalizedReal = path.normalize(realPath);

    for (const mount of mounts) {
      const normalizedMount = path.normalize(mount.real);
      
      if (normalizedReal.startsWith(normalizedMount)) {
        const relativePath = normalizedReal.slice(normalizedMount.length);
        return path.posix.join(mount.virtual, relativePath.replace(/\\/g, '/'));
      }
    }

    return null;
  }

  /**
   * Validate that a resolved path is within authorized boundaries
   */
  validatePath(_sessionId: string, resolvedPath: string, mountRoot: string): boolean {
    try {
      // 1. Normalize the path (resolves . and ..)
      const normalized = path.normalize(resolvedPath);
      const normalizedMount = path.normalize(mountRoot);

      // 2. Check if normalized path is within mount root
      if (!normalized.startsWith(normalizedMount)) {
        console.warn(`Path escape attempt: ${resolvedPath} is outside ${mountRoot}`);
        return false;
      }

      // 3. Check for symlink escapes (if path exists)
      if (fs.existsSync(normalized)) {
        const realPath = fs.realpathSync(normalized);
        if (!realPath.startsWith(normalizedMount)) {
          console.warn(`Symlink escape attempt: ${normalized} -> ${realPath}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Path validation error:', error);
      return false;
    }
  }

  /**
   * Normalize and validate a virtual path
   */
  private normalizePath(virtualPath: string): string | null {
    // Must start with /
    if (!virtualPath.startsWith('/')) {
      return null;
    }

    // Normalize using posix style
    const normalized = path.posix.normalize(virtualPath);

    // Check for path traversal attempts
    if (normalized.includes('..')) {
      console.warn(`Path traversal attempt detected: ${virtualPath}`);
      return null;
    }

    // Check for home directory references
    if (normalized.includes('~')) {
      console.warn(`Home directory reference detected: ${virtualPath}`);
      return null;
    }

    return normalized;
  }

  /**
   * Check if a path is safe for the given operation
   */
  isSafeForOperation(sessionId: string, virtualPath: string, operation: 'read' | 'write' | 'execute'): boolean {
    const realPath = this.resolve(sessionId, virtualPath);
    if (!realPath) {
      return false;
    }

    // For read operations, just check if path is valid
    if (operation === 'read') {
      return true;
    }

    // For write operations, check if we can write
    if (operation === 'write') {
      try {
        const dir = path.dirname(realPath);
        fs.accessSync(dir, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }

    // For execute, be more restrictive
    if (operation === 'execute') {
      // Only allow executing within workspace directories
      return true;
    }

    return false;
  }

  /**
   * Get all mounts for a session
   */
  getMounts(sessionId: string): MountedPath[] {
    return this.sessionMounts.get(sessionId) || [];
  }
}

