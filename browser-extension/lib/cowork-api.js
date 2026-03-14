/**
 * Open Cowork Desktop API Bridge
 *
 * Production API client for connecting the browser extension to the
 * Open Cowork desktop application. Provides bidirectional communication
 * with the Electron main process, including:
 *
 * - Pushing browser activity data to the desktop session manager
 * - Pulling active session status and trace steps
 * - Triggering agent actions from browser context
 * - Syncing workspace context with the sandboxed VM environment
 *
 * The desktop app exposes a local HTTP API (default port 3777) that
 * mirrors the IPC event protocol used internally.
 */

export class CoworkDesktopAPI {
  constructor(baseUrl = 'http://localhost:3777') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.connected = false;
    this.retryCount = 0;
    this.maxRetries = 4;
    this.listeners = new Map();
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  /**
   * Check if the desktop app is running and reachable.
   * @returns {Promise<{ok: boolean, version?: string, sandbox?: string}>}
   */
  async healthCheck() {
    try {
      const resp = await this._fetch('/api/health');
      this.connected = true;
      this.retryCount = 0;
      return resp;
    } catch (err) {
      this.connected = false;
      return { ok: false, error: err.message };
    }
  }

  /**
   * Connect with exponential backoff retry.
   * @returns {Promise<boolean>}
   */
  async connectWithRetry() {
    for (let i = 0; i <= this.maxRetries; i++) {
      const result = await this.healthCheck();
      if (result.ok) return true;
      if (i < this.maxRetries) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s, 8s
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Session operations
  // ---------------------------------------------------------------------------

  /**
   * List all sessions in the desktop app.
   * @returns {Promise<Array>} Sessions
   */
  async listSessions() {
    return this._fetch('/api/sessions');
  }

  /**
   * Get a specific session by ID.
   * @param {string} sessionId
   * @returns {Promise<object>} Session
   */
  async getSession(sessionId) {
    return this._fetch(`/api/sessions/${sessionId}`);
  }

  /**
   * Get messages for a session.
   * @param {string} sessionId
   * @returns {Promise<Array>} Messages
   */
  async getMessages(sessionId) {
    return this._fetch(`/api/sessions/${sessionId}/messages`);
  }

  /**
   * Get trace steps for a session.
   * @param {string} sessionId
   * @returns {Promise<Array>} Trace steps
   */
  async getTraceSteps(sessionId) {
    return this._fetch(`/api/sessions/${sessionId}/trace`);
  }

  /**
   * Start a new session in the desktop app.
   * @param {object} params - { title, prompt, cwd?, allowedTools? }
   * @returns {Promise<object>} Created session
   */
  async startSession(params) {
    return this._fetch('/api/sessions', {
      method: 'POST',
      body: {
        type: 'session.start',
        payload: params,
      },
    });
  }

  /**
   * Continue an existing session with a new prompt.
   * @param {string} sessionId
   * @param {string} prompt
   * @returns {Promise<object>}
   */
  async continueSession(sessionId, prompt) {
    return this._fetch(`/api/sessions/${sessionId}/continue`, {
      method: 'POST',
      body: {
        type: 'session.continue',
        payload: { sessionId, prompt },
      },
    });
  }

  /**
   * Stop a running session.
   * @param {string} sessionId
   * @returns {Promise<object>}
   */
  async stopSession(sessionId) {
    return this._fetch(`/api/sessions/${sessionId}/stop`, {
      method: 'POST',
    });
  }

  // ---------------------------------------------------------------------------
  // Activity reporting (browser -> desktop)
  // ---------------------------------------------------------------------------

  /**
   * Report browser activities to the desktop app for unified tracking.
   * @param {Array} activities - Activity entries from the browser extension
   * @returns {Promise<object>} Sync result
   */
  async reportActivities(activities) {
    return this._fetch('/api/browser/activities', {
      method: 'POST',
      body: {
        source: 'browser_extension',
        version: chrome.runtime?.getManifest?.()?.version || '1.0.0',
        timestamp: Date.now(),
        activities: activities.map((a) => ({
          id: a.id,
          category: a.category,
          hostname: a.hostname,
          title: a.title,
          url: a.url,
          startTime: a.startTime,
          endTime: a.endTime,
          duration: a.duration,
          date: a.date,
          contentSignals: a.contentSignals || null,
        })),
      },
    });
  }

  /**
   * Report a daily summary to the desktop app.
   * @param {object} summary - Daily summary data
   * @returns {Promise<object>}
   */
  async reportDailySummary(summary) {
    return this._fetch('/api/browser/summary', {
      method: 'POST',
      body: {
        source: 'browser_extension',
        timestamp: Date.now(),
        summary,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Workspace / sandbox queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current workspace directory.
   * @returns {Promise<{path: string}>}
   */
  async getWorkspace() {
    return this._fetch('/api/workspace');
  }

  /**
   * Get sandbox status (WSL2/Lima VM info).
   * @returns {Promise<object>} Sandbox info
   */
  async getSandboxStatus() {
    return this._fetch('/api/sandbox/status');
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * Get the desktop app config (provider, model, etc.).
   * @returns {Promise<object>}
   */
  async getConfig() {
    return this._fetch('/api/config');
  }

  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------

  /**
   * List available skills.
   * @returns {Promise<Array>}
   */
  async listSkills() {
    return this._fetch('/api/skills');
  }

  // ---------------------------------------------------------------------------
  // MCP connectors
  // ---------------------------------------------------------------------------

  /**
   * List connected MCP servers.
   * @returns {Promise<Array>}
   */
  async listMCPServers() {
    return this._fetch('/api/mcp/servers');
  }

  // ---------------------------------------------------------------------------
  // Coeadapt integration
  // ---------------------------------------------------------------------------

  /**
   * Push progress data to Coeadapt web app.
   * @param {string} apiUrl - Coeadapt API URL
   * @param {string} apiKey - Coeadapt API key
   * @param {object} payload - Progress data
   * @returns {Promise<object>}
   */
  async syncToCoeadapt(apiUrl, apiKey, payload) {
    const response = await fetch(`${apiUrl}/api/v1/progress/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        source: 'open_cowork',
        timestamp: Date.now(),
        ...payload,
      }),
    });

    if (!response.ok) {
      throw new Error(`Coeadapt sync failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Pull career recommendations from Coeadapt.
   * @param {string} apiUrl
   * @param {string} apiKey
   * @returns {Promise<object>} Recommendations
   */
  async getCoeadaptRecommendations(apiUrl, apiKey) {
    const response = await fetch(`${apiUrl}/api/v1/recommendations`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Coeadapt recommendations failed: ${response.status}`);
    }

    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Event streaming (SSE)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to real-time events from the desktop app via Server-Sent Events.
   * @param {function} onEvent - Callback for each event
   * @returns {function} Unsubscribe function
   */
  subscribeToEvents(onEvent) {
    const eventSource = new EventSource(`${this.baseUrl}/api/events`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent(data);
      } catch {
        // Invalid event data
      }
    };

    eventSource.onerror = () => {
      this.connected = false;
      // EventSource will auto-reconnect
    };

    eventSource.onopen = () => {
      this.connected = true;
    };

    return () => {
      eventSource.close();
    };
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP client
  // ---------------------------------------------------------------------------

  async _fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const config = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'browser-extension',
      },
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }

    return { ok: true };
  }
}

/**
 * Singleton instance for the extension.
 */
let _instance = null;

export function getCoworkAPI(baseUrl) {
  if (!_instance || (baseUrl && _instance.baseUrl !== baseUrl)) {
    _instance = new CoworkDesktopAPI(baseUrl);
  }
  return _instance;
}
