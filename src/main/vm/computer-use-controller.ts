/**
 * Computer Use Controller
 *
 * Provides full computer use capabilities inside a VM for the career agent.
 * Wraps platform-specific screen interaction (screenshots, clicks, typing,
 * scrolling) with a unified API. Coordinates with the VM sandbox adapter
 * to route actions either through the WSL/Lima bridge or the native GUI
 * operate server.
 *
 * Design:
 *   CareerAgentBridge  →  ComputerUseController  →  VM sandbox (WSL/Lima)
 *                                                →  GUI MCP server (native)
 */

import { v4 as uuidv4 } from 'uuid';
import { log, logError, logWarn } from '../utils/logger';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import type {
  ComputerAction,
  ComputerActionRequest,
  ComputerActionResult,
  VMDisplayInfo,
} from './types';

/** Configuration for the computer use controller */
export interface ComputerUseConfig {
  /** Default timeout per action (ms) */
  defaultTimeout?: number;
  /** Whether to capture screenshots after every action */
  autoScreenshot?: boolean;
  /** Maximum screenshot width (for compression) */
  maxScreenshotWidth?: number;
  /** JPEG quality for screenshots (0-100) */
  screenshotQuality?: number;
  /** Default display index */
  defaultDisplayIndex?: number;
}

const DEFAULT_CONFIG: Required<ComputerUseConfig> = {
  defaultTimeout: 30000,
  autoScreenshot: true,
  maxScreenshotWidth: 1280,
  screenshotQuality: 80,
  defaultDisplayIndex: 0,
};

export class ComputerUseController {
  private config: Required<ComputerUseConfig>;
  private displays: VMDisplayInfo[] = [];
  private actionHistory: Array<{ request: ComputerActionRequest; result: ComputerActionResult }> = [];

  constructor(config?: ComputerUseConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    log('[ComputerUseController] Initialized');
  }

  // ==================== High-Level Actions ====================

  /**
   * Take a screenshot of the VM screen
   */
  async screenshot(displayIndex?: number): Promise<ComputerActionResult> {
    const request = this.buildRequest('screenshot', {
      target: { displayIndex: displayIndex ?? this.config.defaultDisplayIndex },
      captureScreenshot: true,
    });

    return this.executeAction(request);
  }

  /**
   * Click at screen coordinates
   */
  async click(
    x: number,
    y: number,
    options?: { displayIndex?: number; button?: 'left' | 'right' | 'double' }
  ): Promise<ComputerActionResult> {
    const action: ComputerAction =
      options?.button === 'right' ? 'right_click' :
      options?.button === 'double' ? 'double_click' :
      'click';

    const request = this.buildRequest(action, {
      target: {
        x,
        y,
        displayIndex: options?.displayIndex ?? this.config.defaultDisplayIndex,
      },
    });

    return this.executeAction(request);
  }

  /**
   * Type text at the current cursor position
   */
  async type(text: string): Promise<ComputerActionResult> {
    const request = this.buildRequest('type', { text });
    return this.executeAction(request);
  }

  /**
   * Press a key or key combination
   */
  async key(keyCombo: string): Promise<ComputerActionResult> {
    const request = this.buildRequest('key', { key: keyCombo });
    return this.executeAction(request);
  }

  /**
   * Scroll at coordinates
   */
  async scroll(
    x: number,
    y: number,
    delta: number,
    displayIndex?: number
  ): Promise<ComputerActionResult> {
    const request = this.buildRequest('scroll', {
      target: {
        x,
        y,
        displayIndex: displayIndex ?? this.config.defaultDisplayIndex,
      },
      scrollDelta: delta,
    });

    return this.executeAction(request);
  }

  /**
   * Move the mouse to coordinates
   */
  async move(x: number, y: number, displayIndex?: number): Promise<ComputerActionResult> {
    const request = this.buildRequest('move', {
      target: {
        x,
        y,
        displayIndex: displayIndex ?? this.config.defaultDisplayIndex,
      },
    });

    return this.executeAction(request);
  }

  /**
   * Drag from one point to another
   */
  async drag(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    displayIndex?: number
  ): Promise<ComputerActionResult> {
    // Drag is implemented as: move to start → mouse down → move to end → mouse up
    const request = this.buildRequest('drag', {
      target: {
        x: fromX,
        y: fromY,
        displayIndex: displayIndex ?? this.config.defaultDisplayIndex,
      },
      // Encode destination in the text field for the daemon to parse
      text: JSON.stringify({ toX, toY }),
    });

    return this.executeAction(request);
  }

  /**
   * Wait for a specified duration
   */
  async wait(durationMs: number): Promise<ComputerActionResult> {
    const request = this.buildRequest('wait', {
      timeout: durationMs,
    });

    return this.executeAction(request);
  }

  /**
   * Execute a bash command inside the VM
   */
  async bash(command: string, timeout?: number): Promise<ComputerActionResult> {
    const request = this.buildRequest('bash', {
      command,
      timeout: timeout ?? this.config.defaultTimeout,
    });

    return this.executeAction(request);
  }

  /**
   * Open an application by name
   */
  async openApp(appName: string): Promise<ComputerActionResult> {
    const request = this.buildRequest('open_app', {
      target: { appName },
    });

    return this.executeAction(request);
  }

  /**
   * Get display/screen information
   */
  async getScreenInfo(): Promise<ComputerActionResult> {
    const request = this.buildRequest('get_screen_info', {});
    const result = await this.executeAction(request);

    // Parse display info from result
    if (result.success && result.stdout) {
      try {
        this.displays = JSON.parse(result.stdout);
      } catch {
        // stdout may not be JSON
      }
    }

    return result;
  }

  // ==================== Compound Actions ====================

  /**
   * Click at a location and then type text (common pattern for form filling)
   */
  async clickAndType(
    x: number,
    y: number,
    text: string,
    options?: { displayIndex?: number; clearFirst?: boolean }
  ): Promise<ComputerActionResult> {
    // Click the target
    const clickResult = await this.click(x, y, options);
    if (!clickResult.success) return clickResult;

    // Optionally clear existing text
    if (options?.clearFirst) {
      await this.key('ctrl+a');
      await this.key('delete');
    }

    // Type the text
    return this.type(text);
  }

  /**
   * Wait for a condition by repeatedly taking screenshots
   * Useful for waiting for UI transitions to complete
   */
  async waitForScreen(
    conditionDescription: string,
    options?: { maxAttempts?: number; intervalMs?: number }
  ): Promise<ComputerActionResult> {
    const maxAttempts = options?.maxAttempts ?? 10;
    const interval = options?.intervalMs ?? 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.screenshot();
      if (!result.success) return result;

      // Return the screenshot - the career agent can analyze it
      // to determine if the condition is met
      if (attempt === maxAttempts - 1) {
        return result;
      }

      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    return {
      id: uuidv4(),
      requestId: 'wait-for-screen',
      success: false,
      error: `Timed out waiting for: ${conditionDescription}`,
    };
  }

  // ==================== Core Execution ====================

  /**
   * Execute a single computer action, routing to the appropriate backend
   */
  async executeAction(request: ComputerActionRequest): Promise<ComputerActionResult> {
    const startTime = Date.now();

    try {
      log(`[ComputerUseController] Executing: ${request.action} (${request.id})`);

      const result = await this.routeAction(request);

      // Auto-capture screenshot after action if enabled
      if (
        this.config.autoScreenshot &&
        request.captureScreenshot !== false &&
        request.action !== 'screenshot' &&
        request.action !== 'wait' &&
        request.action !== 'get_screen_info'
      ) {
        const screenshotResult = await this.captureScreenshot(request);
        if (screenshotResult.screenshotBase64) {
          result.screenshotBase64 = screenshotResult.screenshotBase64;
          result.screenWidth = screenshotResult.screenWidth;
          result.screenHeight = screenshotResult.screenHeight;
        }
      }

      result.duration = Date.now() - startTime;

      // Store in history
      this.actionHistory.push({ request, result });
      if (this.actionHistory.length > 100) {
        this.actionHistory.shift();
      }

      log(`[ComputerUseController] ${request.action} completed in ${result.duration}ms (success: ${result.success})`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logError(`[ComputerUseController] ${request.action} failed:`, errorMsg);

      return {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute a batch of actions sequentially
   */
  async executeBatch(
    requests: ComputerActionRequest[]
  ): Promise<ComputerActionResult[]> {
    const results: ComputerActionResult[] = [];

    for (const request of requests) {
      const result = await this.executeAction(request);
      results.push(result);

      // Stop batch on failure unless the action explicitly allows continuation
      if (!result.success) {
        log(`[ComputerUseController] Batch stopped at action ${request.action}: ${result.error}`);
        break;
      }
    }

    return results;
  }

  // ==================== Internal Routing ====================

  /**
   * Route an action to the appropriate execution backend
   */
  private async routeAction(request: ComputerActionRequest): Promise<ComputerActionResult> {
    const sandbox = getSandboxAdapter();

    if (sandbox.isWSL || sandbox.isLima) {
      return this.executeViaVM(request, sandbox.isWSL ? 'wsl' : 'lima');
    }

    // Native mode - execute via platform-specific commands
    return this.executeNative(request);
  }

  /**
   * Execute action via VM (WSL or Lima)
   */
  private async executeViaVM(
    request: ComputerActionRequest,
    _vmType: 'wsl' | 'lima'
  ): Promise<ComputerActionResult> {
    const sandbox = getSandboxAdapter();
    const command = this.buildVMCommand(request);

    try {
      const execResult = await sandbox.executeCommand(command);

      return {
        id: uuidv4(),
        requestId: request.id,
        success: execResult.success,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        exitCode: execResult.exitCode,
        error: execResult.success ? undefined : execResult.stderr || `Exit code: ${execResult.exitCode}`,
      };
    } catch (error) {
      return {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute action natively (no VM)
   */
  private async executeNative(request: ComputerActionRequest): Promise<ComputerActionResult> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const platform = process.platform;
    const command = platform === 'darwin'
      ? this.buildMacOSCommand(request)
      : this.buildLinuxCommand(request);

    if (!command) {
      return {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        error: `Unsupported action for native execution: ${request.action}`,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: request.timeout || this.config.defaultTimeout,
      });

      return {
        id: uuidv4(),
        requestId: request.id,
        success: true,
        stdout,
        stderr,
      };
    } catch (error: any) {
      return {
        id: uuidv4(),
        requestId: request.id,
        success: false,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.code,
        error: error.message,
      };
    }
  }

  // ==================== Command Builders ====================

  /**
   * Build a command string for VM execution
   * The VM daemon understands these JSON-RPC style commands
   */
  private buildVMCommand(request: ComputerActionRequest): string {
    const payload = JSON.stringify({
      action: request.action,
      target: request.target,
      text: request.text,
      key: request.key,
      scrollDelta: request.scrollDelta,
      command: request.command,
      captureScreenshot: request.captureScreenshot ?? this.config.autoScreenshot,
    });

    // Use the vm-agent-daemon's computer-use endpoint
    return `echo '${payload.replace(/'/g, "'\\''")}' | /tmp/vm-computer-use-action`;
  }

  /**
   * Build macOS-specific commands using cliclick and screencapture
   */
  private buildMacOSCommand(request: ComputerActionRequest): string | null {
    const target = request.target || {};
    const x = target.x ?? 0;
    const y = target.y ?? 0;

    switch (request.action) {
      case 'screenshot': {
        const tmpFile = `/tmp/screenshot-${Date.now()}.png`;
        return `screencapture -x ${tmpFile} && base64 -i ${tmpFile} && rm -f ${tmpFile}`;
      }

      case 'click':
        return `cliclick c:${x},${y}`;

      case 'double_click':
        return `cliclick dc:${x},${y}`;

      case 'right_click':
        return `cliclick rc:${x},${y}`;

      case 'type':
        if (!request.text) return null;
        // Escape for shell
        const escaped = request.text.replace(/'/g, "'\\''");
        return `cliclick t:'${escaped}'`;

      case 'key':
        if (!request.key) return null;
        return `cliclick kp:${request.key}`;

      case 'scroll':
        return `cliclick m:${x},${y} && cliclick "scroll:${request.scrollDelta || 0},0"`;

      case 'move':
        return `cliclick m:${x},${y}`;

      case 'wait':
        return `sleep ${(request.timeout || 1000) / 1000}`;

      case 'bash':
        return request.command || null;

      case 'open_app':
        if (!target.appName) return null;
        return `open -a "${target.appName.replace(/"/g, '\\"')}"`;

      case 'get_screen_info':
        return `system_profiler SPDisplaysDataType -json 2>/dev/null || echo '[]'`;

      default:
        return null;
    }
  }

  /**
   * Build Linux-specific commands using xdotool and xwd/import
   */
  private buildLinuxCommand(request: ComputerActionRequest): string | null {
    const target = request.target || {};
    const x = target.x ?? 0;
    const y = target.y ?? 0;

    switch (request.action) {
      case 'screenshot': {
        const tmpFile = `/tmp/screenshot-${Date.now()}.png`;
        // Try import (ImageMagick) first, fall back to scrot
        return `(import -window root ${tmpFile} 2>/dev/null || scrot ${tmpFile} 2>/dev/null || xwd -root -silent | convert xwd:- ${tmpFile}) && base64 ${tmpFile} && rm -f ${tmpFile}`;
      }

      case 'click':
        return `xdotool mousemove ${x} ${y} click 1`;

      case 'double_click':
        return `xdotool mousemove ${x} ${y} click --repeat 2 1`;

      case 'right_click':
        return `xdotool mousemove ${x} ${y} click 3`;

      case 'type':
        if (!request.text) return null;
        const escaped = request.text.replace(/'/g, "'\\''");
        return `xdotool type --clearmodifiers '${escaped}'`;

      case 'key':
        if (!request.key) return null;
        // Convert common key names to xdotool format
        const xdoKey = request.key
          .replace(/ctrl/gi, 'ctrl')
          .replace(/alt/gi, 'alt')
          .replace(/shift/gi, 'shift')
          .replace(/\+/g, '+');
        return `xdotool key ${xdoKey}`;

      case 'scroll':
        // xdotool: button 4 = scroll up, button 5 = scroll down
        const delta = request.scrollDelta || 0;
        const button = delta > 0 ? 4 : 5;
        const clicks = Math.abs(Math.round(delta / 3)) || 1;
        return `xdotool mousemove ${x} ${y} click --repeat ${clicks} ${button}`;

      case 'move':
        return `xdotool mousemove ${x} ${y}`;

      case 'drag': {
        let toX = x, toY = y;
        if (request.text) {
          try {
            const dest = JSON.parse(request.text);
            toX = dest.toX;
            toY = dest.toY;
          } catch { /* ignore */ }
        }
        return `xdotool mousemove ${x} ${y} mousedown 1 mousemove ${toX} ${toY} mouseup 1`;
      }

      case 'wait':
        return `sleep ${(request.timeout || 1000) / 1000}`;

      case 'bash':
        return request.command || null;

      case 'open_app':
        if (!target.appName) return null;
        return `xdg-open "${target.appName.replace(/"/g, '\\"')}" 2>/dev/null || ${target.appName} &`;

      case 'get_screen_info':
        return `xrandr --query 2>/dev/null | head -20 || echo 'xrandr not available'`;

      default:
        return null;
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Capture a screenshot (used internally after other actions)
   */
  private async captureScreenshot(
    context: ComputerActionRequest
  ): Promise<Partial<ComputerActionResult>> {
    try {
      const screenshotRequest = this.buildRequest('screenshot', {
        target: context.target,
        captureScreenshot: true,
      });

      const result = await this.routeAction(screenshotRequest);

      if (result.success && result.stdout) {
        // stdout contains base64-encoded screenshot
        return {
          screenshotBase64: result.stdout.trim(),
          screenWidth: this.displays[0]?.width,
          screenHeight: this.displays[0]?.height,
        };
      }

      return {};
    } catch (error) {
      logWarn('[ComputerUseController] Failed to capture screenshot after action:', error);
      return {};
    }
  }

  /**
   * Build a ComputerActionRequest from partial inputs
   */
  private buildRequest(
    action: ComputerAction,
    partial: Partial<Omit<ComputerActionRequest, 'id' | 'action'>>
  ): ComputerActionRequest {
    return {
      id: uuidv4(),
      taskId: '',
      stepId: '',
      action,
      captureScreenshot: partial.captureScreenshot ?? (action === 'screenshot'),
      timeout: partial.timeout ?? this.config.defaultTimeout,
      ...partial,
    };
  }

  // ==================== Queries ====================

  /** Get cached display info */
  getDisplays(): VMDisplayInfo[] {
    return this.displays;
  }

  /** Get recent action history */
  getHistory(limit?: number): Array<{ request: ComputerActionRequest; result: ComputerActionResult }> {
    const count = limit ?? 20;
    return this.actionHistory.slice(-count);
  }

  /** Get the last action result */
  getLastResult(): ComputerActionResult | null {
    const last = this.actionHistory[this.actionHistory.length - 1];
    return last?.result ?? null;
  }
}
