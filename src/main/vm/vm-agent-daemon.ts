/**
 * VM Agent Daemon
 *
 * A lightweight daemon that runs inside the VM (WSL/Lima) to enable
 * computer use actions and automatic progress reporting. It listens
 * for JSON-RPC commands on stdin and reports events on stdout, following
 * the same pattern as the existing lima-agent and wsl-agent but extended
 * with computer-use and progress-tracking capabilities.
 *
 * This daemon is spawned by the host-side CareerAgentBridge when a
 * career-agent task needs full computer control inside the VM.
 *
 * Capabilities:
 *   - Execute computer-use actions (screenshot, click, type, etc.)
 *   - Report step-level progress back to the host
 *   - Maintain heartbeat so the host knows the VM is alive
 *   - Handle task lifecycle (start, pause, resume, cancel)
 */

import * as readline from 'readline';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Types (inline to avoid import issues when running standalone in VM)
// ============================================================================

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

interface VMEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface ComputerActionParams {
  action: string;
  target?: { x?: number; y?: number; displayIndex?: number; appName?: string };
  text?: string;
  key?: string;
  scrollDelta?: number;
  command?: string;
  captureScreenshot?: boolean;
  timeout?: number;
}

interface TaskStepUpdate {
  taskId: string;
  stepId: string;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  screenshotBase64?: string;
  error?: string;
}

// ============================================================================
// Logging (stderr to keep stdout clean for JSON-RPC)
// ============================================================================

function log(...args: unknown[]): void {
  console.error('[VMAgentDaemon]', new Date().toISOString(), ...args);
}

function logError(...args: unknown[]): void {
  console.error('[VMAgentDaemon ERROR]', new Date().toISOString(), ...args);
}

// ============================================================================
// Platform Detection
// ============================================================================

function detectPlatformTools(): {
  hasXdotool: boolean;
  hasScrot: boolean;
  hasImport: boolean;
  hasXrandr: boolean;
  hasXwd: boolean;
} {
  const check = (cmd: string): boolean => {
    try {
      require('child_process').execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  return {
    hasXdotool: check('xdotool'),
    hasScrot: check('scrot'),
    hasImport: check('import'),
    hasXrandr: check('xrandr'),
    hasXwd: check('xwd'),
  };
}

// ============================================================================
// VM Agent Daemon
// ============================================================================

class VMAgentDaemon {
  private workspacePath: string = '';
  private taskId: string = '';
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private platformTools = detectPlatformTools();
  private _isShuttingDown = false;

  constructor() {
    log('Platform tools:', JSON.stringify(this.platformTools));
  }

  // ==================== Lifecycle ====================

  setWorkspace(params: { path: string; macPath?: string; windowsPath?: string }): { success: boolean } {
    this.workspacePath = path.resolve(params.path);
    log('Workspace set to:', this.workspacePath);
    return { success: true };
  }

  startTask(params: { taskId: string; steps?: Array<{ id: string; title: string }> }): { success: boolean } {
    this.taskId = params.taskId;
    log('Task started:', this.taskId);

    // Start heartbeat
    this.startHeartbeat();

    // Emit task started event
    this.emitEvent({
      type: 'vm.task.updated',
      payload: { taskId: this.taskId, updates: { status: 'running' } },
    });

    return { success: true };
  }

  pauseTask(): { success: boolean } {
    this.stopHeartbeat();
    this.emitEvent({
      type: 'vm.task.updated',
      payload: { taskId: this.taskId, updates: { status: 'paused' } },
    });
    return { success: true };
  }

  resumeTask(): { success: boolean } {
    this.startHeartbeat();
    this.emitEvent({
      type: 'vm.task.updated',
      payload: { taskId: this.taskId, updates: { status: 'running' } },
    });
    return { success: true };
  }

  cancelTask(): { success: boolean } {
    this.stopHeartbeat();
    this.emitEvent({
      type: 'vm.task.updated',
      payload: { taskId: this.taskId, updates: { status: 'cancelled' } },
    });
    return { success: true };
  }

  shutdown(): { success: boolean } {
    log('Shutting down...');
    this._isShuttingDown = true;
    this.stopHeartbeat();
    setImmediate(() => process.exit(0));
    return { success: true };
  }

  ping(): { pong: boolean; taskId: string; timestamp: number } {
    return { pong: true, taskId: this.taskId, timestamp: Date.now() };
  }

  // ==================== Computer Use Actions ====================

  async computerAction(params: ComputerActionParams): Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    screenshotBase64?: string;
    error?: string;
    duration?: number;
  }> {
    const startTime = Date.now();
    const { action, target, text, key, scrollDelta, command: bashCommand, captureScreenshot, timeout } = params;

    log(`Action: ${action}`, target ? `at (${target.x}, ${target.y})` : '');

    try {
      let result: { stdout: string; stderr: string; exitCode: number };

      switch (action) {
        case 'screenshot':
          result = await this.takeScreenshot();
          break;

        case 'click':
          result = await this.performClick(target?.x || 0, target?.y || 0, 'left');
          break;

        case 'double_click':
          result = await this.performClick(target?.x || 0, target?.y || 0, 'double');
          break;

        case 'right_click':
          result = await this.performClick(target?.x || 0, target?.y || 0, 'right');
          break;

        case 'type':
          result = await this.performType(text || '');
          break;

        case 'key':
          result = await this.performKeyPress(key || '');
          break;

        case 'scroll':
          result = await this.performScroll(target?.x || 0, target?.y || 0, scrollDelta || 0);
          break;

        case 'move':
          result = await this.performMouseMove(target?.x || 0, target?.y || 0);
          break;

        case 'drag':
          result = await this.performDrag(target?.x || 0, target?.y || 0, text || '');
          break;

        case 'wait':
          await new Promise(resolve => setTimeout(resolve, timeout || 1000));
          result = { stdout: 'waited', stderr: '', exitCode: 0 };
          break;

        case 'bash':
          result = await this.executeBash(bashCommand || '', timeout);
          break;

        case 'open_app':
          result = await this.openApplication(target?.appName || '');
          break;

        case 'get_screen_info':
          result = await this.getScreenInfo();
          break;

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            duration: Date.now() - startTime,
          };
      }

      const response: any = {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
      };

      // Capture screenshot after action if requested
      if (captureScreenshot && action !== 'screenshot') {
        try {
          const screenshot = await this.takeScreenshot();
          if (screenshot.exitCode === 0) {
            response.screenshotBase64 = screenshot.stdout.trim();
          }
        } catch (err) {
          log('Failed to capture post-action screenshot:', err);
        }
      }

      // For screenshot action, the stdout IS the base64
      if (action === 'screenshot' && result.exitCode === 0) {
        response.screenshotBase64 = result.stdout.trim();
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  // ==================== Progress Reporting ====================

  async updateStepProgress(params: TaskStepUpdate): Promise<{ success: boolean }> {
    const { taskId, stepId, status, output, screenshotBase64, error } = params;

    if (status === 'running') {
      this.emitEvent({
        type: 'vm.step.started',
        payload: {
          taskId,
          step: { id: stepId, status: 'running', startedAt: Date.now() },
        },
      });
    } else if (status === 'completed') {
      this.emitEvent({
        type: 'vm.step.completed',
        payload: {
          taskId,
          stepId,
          result: {
            id: stepId,
            requestId: stepId,
            success: true,
            stdout: output,
            screenshotBase64,
          },
        },
      });
    } else if (status === 'failed') {
      this.emitEvent({
        type: 'vm.step.failed',
        payload: { taskId, stepId, error: error || 'Unknown error' },
      });
    }

    return { success: true };
  }

  async reportProgress(params: {
    taskId: string;
    sessionId: string;
    progress: number;
    currentStep?: string;
    stepsCompleted: number;
    stepsTotal: number;
  }): Promise<{ success: boolean }> {
    this.emitEvent({
      type: 'vm.progress',
      payload: {
        ...params,
        title: '', // Host will fill from task
        status: 'running',
        updatedAt: Date.now(),
      },
    });
    return { success: true };
  }

  async completeTask(params: {
    taskId: string;
    summary: string;
    stepsCompleted: number;
    stepsTotal: number;
    artifacts?: Array<{ type: string; name: string; value: string }>;
  }): Promise<{ success: boolean }> {
    this.stopHeartbeat();

    this.emitEvent({
      type: 'vm.task.completed',
      payload: {
        taskId: params.taskId,
        result: {
          taskId: params.taskId,
          success: true,
          summary: params.summary,
          stepsCompleted: params.stepsCompleted,
          stepsTotal: params.stepsTotal,
          totalDuration: 0, // Host will compute
          artifacts: params.artifacts,
        },
      },
    });

    return { success: true };
  }

  async failTask(params: { taskId: string; error: string }): Promise<{ success: boolean }> {
    this.stopHeartbeat();

    this.emitEvent({
      type: 'vm.error',
      payload: { taskId: params.taskId, error: params.error, recoverable: false },
    });

    return { success: true };
  }

  // ==================== Low-Level Platform Commands ====================

  private async takeScreenshot(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const tmpFile = `/tmp/vm-screenshot-${Date.now()}.png`;

    if (this.platformTools.hasImport) {
      return this.runCmd(`import -window root ${tmpFile} && base64 ${tmpFile} && rm -f ${tmpFile}`);
    } else if (this.platformTools.hasScrot) {
      return this.runCmd(`scrot ${tmpFile} && base64 ${tmpFile} && rm -f ${tmpFile}`);
    } else if (this.platformTools.hasXwd) {
      return this.runCmd(`xwd -root -silent | convert xwd:- ${tmpFile} && base64 ${tmpFile} && rm -f ${tmpFile}`);
    }

    return { stdout: '', stderr: 'No screenshot tool available (install scrot, imagemagick, or xwd)', exitCode: 1 };
  }

  private async performClick(
    x: number,
    y: number,
    button: 'left' | 'right' | 'double'
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    switch (button) {
      case 'left':
        return this.runCmd(`xdotool mousemove ${x} ${y} click 1`);
      case 'right':
        return this.runCmd(`xdotool mousemove ${x} ${y} click 3`);
      case 'double':
        return this.runCmd(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
    }
  }

  private async performType(text: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    const escaped = text.replace(/'/g, "'\\''");
    return this.runCmd(`xdotool type --clearmodifiers '${escaped}'`);
  }

  private async performKeyPress(key: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    return this.runCmd(`xdotool key ${key}`);
  }

  private async performScroll(
    x: number,
    y: number,
    delta: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    const button = delta > 0 ? 4 : 5; // 4=up, 5=down
    const clicks = Math.abs(Math.round(delta / 3)) || 1;
    return this.runCmd(`xdotool mousemove ${x} ${y} click --repeat ${clicks} ${button}`);
  }

  private async performMouseMove(x: number, y: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    return this.runCmd(`xdotool mousemove ${x} ${y}`);
  }

  private async performDrag(
    x: number,
    y: number,
    destJson: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.platformTools.hasXdotool) {
      return { stdout: '', stderr: 'xdotool not available', exitCode: 1 };
    }

    let toX = x, toY = y;
    try {
      const dest = JSON.parse(destJson);
      toX = dest.toX ?? x;
      toY = dest.toY ?? y;
    } catch { /* use same coords */ }

    return this.runCmd(`xdotool mousemove ${x} ${y} mousedown 1 mousemove ${toX} ${toY} mouseup 1`);
  }

  private async executeBash(
    command: string,
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    // Validate workspace bounds
    if (this.workspacePath) {
      if (command.includes('../') || command.includes('..\\')) {
        return { stdout: '', stderr: 'Path traversal not allowed', exitCode: 1 };
      }
    }

    return this.runCmd(command, timeout);
  }

  private async openApplication(appName: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const sanitized = appName.replace(/[;&|`$]/g, '');
    return this.runCmd(`xdg-open "${sanitized}" 2>/dev/null || ${sanitized} &`);
  }

  private async getScreenInfo(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.platformTools.hasXrandr) {
      const result = await this.runCmd('xrandr --query 2>/dev/null');
      // Parse xrandr output into structured display info
      try {
        const displays: Array<{
          index: number; width: number; height: number; scaleFactor: number; isPrimary: boolean;
        }> = [];

        const lines = result.stdout.split('\n');
        let displayIdx = 0;

        for (const line of lines) {
          const match = line.match(/(\d+)x(\d+)\+\d+\+\d+/);
          const isPrimary = line.includes('primary');
          if (match) {
            displays.push({
              index: displayIdx++,
              width: parseInt(match[1], 10),
              height: parseInt(match[2], 10),
              scaleFactor: 1,
              isPrimary,
            });
          }
        }

        return {
          stdout: JSON.stringify(displays),
          stderr: '',
          exitCode: 0,
        };
      } catch {
        return result;
      }
    }

    return { stdout: '[]', stderr: 'xrandr not available', exitCode: 1 };
  }

  // ==================== Helpers ====================

  private async runCmd(
    command: string,
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout || 30000,
        cwd: this.workspacePath || '/tmp',
        env: {
          ...process.env,
          DISPLAY: process.env.DISPLAY || ':0',
        },
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        exitCode: error.code ?? 1,
      };
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.taskId) {
        this.emitEvent({
          type: 'vm.heartbeat',
          payload: { taskId: this.taskId, timestamp: Date.now() },
        });
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private emitEvent(event: VMEvent): void {
    // Events are sent as special JSON lines on stdout, prefixed with EVENT:
    const line = `EVENT:${JSON.stringify(event)}`;
    console.log(line);
  }

  // ==================== JSON-RPC Handler ====================

  async handleRequest(request: JSONRPCRequest): Promise<unknown> {
    const { method, params } = request;

    switch (method) {
      case 'ping':
        return this.ping();

      case 'setWorkspace':
        return this.setWorkspace(params as any);

      case 'startTask':
        return this.startTask(params as any);

      case 'pauseTask':
        return this.pauseTask();

      case 'resumeTask':
        return this.resumeTask();

      case 'cancelTask':
        return this.cancelTask();

      case 'computerAction':
        return this.computerAction(params as ComputerActionParams);

      case 'updateStepProgress':
        return this.updateStepProgress(params as TaskStepUpdate);

      case 'reportProgress':
        return this.reportProgress(params as any);

      case 'completeTask':
        return this.completeTask(params as any);

      case 'failTask':
        return this.failTask(params as any);

      case 'shutdown':
        return this.shutdown();

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const daemon = new VMAgentDaemon();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  log('VM Agent Daemon started');
  log('PID:', process.pid);
  log('Working directory:', process.cwd());

  function sendResponse(response: JSONRPCResponse): void {
    // JSON-RPC responses go to stdout (separate from EVENT: lines)
    console.log(JSON.stringify(response));
  }

  rl.on('line', async (line: string) => {
    if (!line.trim()) return;

    let request: JSONRPCRequest | null = null;

    try {
      request = JSON.parse(line) as JSONRPCRequest;

      if (request.jsonrpc !== '2.0' || !request.id || !request.method) {
        throw new Error('Invalid JSON-RPC request');
      }

      const result = await daemon.handleRequest(request);

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

  process.on('SIGTERM', () => {
    log('Received SIGTERM');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('Received SIGINT');
    process.exit(0);
  });

  process.on('uncaughtException', (error) => {
    logError('Uncaught exception:', error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Failed to start VM Agent Daemon:', error);
  process.exit(1);
});
