/**
 * Routing for remote-session permission requests. Extracted from index.ts so
 * the fallback-to-desktop-dialog paths are unit-testable.
 */

import type { ServerEvent } from '../../renderer/types/index';
import { logError } from '../utils/logger';

export interface PermissionRouteDeps {
  handleRemotePermissionRequest(
    sessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ allow: boolean; remember?: boolean } | null>;
  handlePermissionResponse?(toolUseId: string, result: 'allow' | 'deny' | 'allow_always'): void;
}

/**
 * Route a permission.request event for a remote session: the remote manager
 * takes the request (text prompt in the chat channel). When it cannot handle
 * it — it returns null or throws — the event falls through to the local UI
 * (desktop permission dialog).
 */
export async function routePermissionRequestEvent(
  event: ServerEvent,
  request: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    input: Record<string, unknown>;
  },
  deps: PermissionRouteDeps | null,
  deliver: (event: ServerEvent) => void
): Promise<void> {
  if (!deps) {
    deliver(event);
    return;
  }
  try {
    const result = await deps.handleRemotePermissionRequest(
      request.sessionId,
      request.toolUseId,
      request.toolName,
      request.input
    );
    if (result !== null && deps.handlePermissionResponse) {
      const permissionResult: 'allow' | 'deny' | 'allow_always' = result.allow
        ? result.remember
          ? 'allow_always'
          : 'allow'
        : 'deny';
      deps.handlePermissionResponse(request.toolUseId, permissionResult);
    } else {
      // Not handled remotely (missing mapping, gateway down, send failure) —
      // fall back to the normal desktop permission dialog.
      deliver(event);
    }
  } catch (err) {
    logError('[Remote] Failed to handle permission request:', err);
    deliver(event);
  }
}
