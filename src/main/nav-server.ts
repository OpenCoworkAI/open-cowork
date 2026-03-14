/**
 * @module main/nav-server
 *
 * CLI-driven UI navigation server (155 lines).
 *
 * Exposes HTTP endpoints on 127.0.0.1:19888 for external tools (e.g. Claude Code)
 * to control app page navigation programmatically:
 *   GET /status           → current page state
 *   GET /navigate?page=X  → navigate to welcome, settings, or session pages
 *
 * Dependencies: electron (BrowserWindow)
 */
import * as http from 'http';
import { URL } from 'url';
import { BrowserWindow } from 'electron';

const PORT = 19888;
const HOST = '127.0.0.1';
const EXEC_TIMEOUT_MS = 3000;
const VALID_TABS = new Set([
  'api', 'sandbox', 'connectors',
  'skills', 'schedule', 'remote', 'logs', 'general',
]);

let server: http.Server | null = null;

function json(res: http.ServerResponse, status: number, body: Record<string, unknown>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Run executeJavaScript with a timeout to avoid hanging if the renderer is stuck. */
function execJS(win: BrowserWindow, code: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    win.webContents.executeJavaScript(code).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('executeJavaScript timed out')), EXEC_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Lightweight HTTP server for CLI-driven UI navigation.
 * Allows CC/Codex to navigate the app to different pages via curl.
 *
 * Routes:
 *   GET /navigate?page=welcome
 *   GET /navigate?page=settings&tab=api
 *   GET /navigate?page=session&id=xxx
 *   GET /status
 */
export function startNavServer(getMainWindow: () => BrowserWindow | null): void {
  if (server) return;

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      const pathname = url.pathname;

      if (pathname === '/navigate') {
        const page = url.searchParams.get('page');
        const tab = url.searchParams.get('tab') || undefined;
        const sessionId = url.searchParams.get('id') || undefined;

        if (!page || !['welcome', 'settings', 'session'].includes(page)) {
          return json(res, 400, { ok: false, error: 'Invalid page. Use: welcome, settings, session' });
        }

        if (page === 'settings' && tab && !VALID_TABS.has(tab)) {
          return json(res, 400, {
            ok: false,
            error: `Invalid tab "${tab}". Use: ${[...VALID_TABS].join(', ')}`,
          });
        }

        if (page === 'session' && !sessionId) {
          return json(res, 400, { ok: false, error: 'session page requires id param' });
        }

        const win = getMainWindow();
        if (!win || win.isDestroyed()) {
          return json(res, 503, { ok: false, error: 'No active window' });
        }

        // Use executeJavaScript to call store actions directly — more reliable
        // than IPC events which can get lost in the preload→React listener chain.
        // JSON.stringify the args to avoid string interpolation injection.
        const args = JSON.stringify([page, tab ?? null, sessionId ?? null]);
        try {
          const result = await execJS(win,
            `window.__navigate && window.__navigate(...${args})`
          );
          if (!result) {
            return json(res, 503, { ok: false, error: 'Renderer not ready (window.__navigate not available)' });
          }
        } catch (err) {
          console.error('[NavServer] /navigate executeJavaScript error:', err);
          return json(res, 500, { ok: false, error: 'Failed to execute navigation' });
        }

        return json(res, 200, { ok: true, navigated: { page, tab, sessionId } });
      }

      if (pathname === '/status') {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) {
          return json(res, 503, { ok: false, error: 'No active window' });
        }

        try {
          const state = await execJS(win,
            `JSON.stringify(window.__getNavStatus ? window.__getNavStatus() : {})`
          ) as string;
          const parsed = JSON.parse(state);
          let currentPage = 'welcome';
          if (parsed.showSettings) currentPage = 'settings';
          else if (parsed.activeSessionId) currentPage = 'session';

          return json(res, 200, {
            ok: true,
            page: currentPage,
            activeSessionId: parsed.activeSessionId,
            sessionCount: parsed.sessionCount,
          });
        } catch (err) {
          console.error('[NavServer] /status error:', err);
          return json(res, 500, { ok: false, error: 'Failed to read renderer state' });
        }
      }

      json(res, 404, { ok: false, error: 'Not found. Use /navigate or /status' });
    } catch (err) {
      console.error('[NavServer] Unexpected error:', err);
      if (!res.headersSent) {
        json(res, 500, { ok: false, error: 'Internal server error' });
      }
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[NavServer] Listening on http://${HOST}:${PORT}`);
  });

  // Don't let the server prevent app exit
  server.unref();

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[NavServer] Port ${PORT} already in use, skipping`);
    } else {
      console.error('[NavServer] Failed to start:', err);
    }
    server = null;
  });
}

export function stopNavServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
