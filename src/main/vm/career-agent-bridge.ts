/**
 * Career Agent Bridge
 *
 * The central orchestrator connecting the Open Claw career agent to the
 * VM progress tracking system and computer use controller. This bridge:
 *
 *   1. Receives high-level goals from the career agent
 *   2. Breaks them into tracked steps via the progress tracker
 *   3. Executes computer-use actions through the controller
 *   4. Manages the VM daemon lifecycle (spawn/connect/shutdown)
 *   5. Reports real-time progress to the Electron renderer
 *
 * Architecture:
 *
 *   Career Agent (external)
 *        │
 *        ▼
 *   CareerAgentBridge  ──►  VMProgressTracker  ──►  Renderer UI
 *        │
 *        ▼
 *   ComputerUseController
 *        │
 *        ├──► VM Daemon (WSL/Lima)  [for sandboxed execution]
 *        └──► Native GUI Server     [for host screen interaction]
 */

import { v4 as uuidv4 } from 'uuid';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import { log, logError, logWarn } from '../utils/logger';
import { getSandboxAdapter } from '../sandbox/sandbox-adapter';
import { VMProgressTracker, type VMProgressEvent } from './vm-progress-tracker';
import { ComputerUseController, type ComputerUseConfig } from './computer-use-controller';
import type {
  VMTaskStep,
  VMTaskResult,
  CareerAgentMetadata,
  CareerAgentPlan,
  ComputerAction,
  ComputerActionRequest,
  ComputerActionResult,
  VMDaemonEvent,
  VMDaemonCommand,
} from './types';
import type { ServerEvent } from '../../renderer/types';

/** Configuration for the career agent bridge */
export interface CareerAgentBridgeConfig {
  /** Path to the VM agent daemon script */
  daemonScriptPath?: string;
  /** Computer use settings */
  computerUse?: ComputerUseConfig;
  /** Max time to wait for daemon to start (ms) */
  daemonStartTimeout?: number;
  /** Whether to auto-start the VM daemon */
  autoStartDaemon?: boolean;
}

const DEFAULT_BRIDGE_CONFIG: Required<CareerAgentBridgeConfig> = {
  daemonScriptPath: '',
  computerUse: {},
  daemonStartTimeout: 15000,
  autoStartDaemon: true,
};

/** Status of the bridge connection to the VM daemon */
export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class CareerAgentBridge {
  private config: Required<CareerAgentBridgeConfig>;
  private progressTracker: VMProgressTracker;
  private computerUse: ComputerUseController;
  private sendToRenderer: ((event: ServerEvent) => void) | null = null;

  // VM Daemon management
  private daemonProcess: ChildProcess | null = null;
  private daemonStatus: BridgeStatus = 'disconnected';
  private pendingRequests: Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();
  private eventBuffer: string = '';

  constructor(config?: CareerAgentBridgeConfig) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this.progressTracker = new VMProgressTracker();
    this.computerUse = new ComputerUseController(this.config.computerUse);

    // Wire up progress tracker events to renderer
    this.progressTracker.onProgress((event) => {
      this.forwardProgressEvent(event);
    });

    log('[CareerAgentBridge] Initialized');
  }

  // ==================== Public API ====================

  /**
   * Connect the bridge to the renderer for progress updates
   */
  connectRenderer(sendToRenderer: (event: ServerEvent) => void): void {
    this.sendToRenderer = sendToRenderer;
    log('[CareerAgentBridge] Renderer connected');
  }

  /**
   * Start the VM daemon for computer use
   */
  async startDaemon(workspacePath?: string): Promise<boolean> {
    if (this.daemonStatus === 'connected') {
      log('[CareerAgentBridge] Daemon already connected');
      return true;
    }

    this.daemonStatus = 'connecting';

    try {
      const sandbox = getSandboxAdapter();
      const daemonPath = this.resolveDaemonPath();

      if (!daemonPath) {
        logWarn('[CareerAgentBridge] Daemon script not found, using direct execution mode');
        this.daemonStatus = 'connected'; // Degraded mode: direct execution
        return true;
      }

      if (sandbox.isWSL) {
        return this.startWSLDaemon(daemonPath, workspacePath);
      } else if (sandbox.isLima) {
        return this.startLimaDaemon(daemonPath, workspacePath);
      } else {
        // Native mode - daemon not needed, use direct execution
        this.daemonStatus = 'connected';
        log('[CareerAgentBridge] Running in native mode (no VM daemon needed)');
        return true;
      }
    } catch (error) {
      logError('[CareerAgentBridge] Failed to start daemon:', error);
      this.daemonStatus = 'error';
      return false;
    }
  }

  /**
   * Stop the VM daemon
   */
  async stopDaemon(): Promise<void> {
    if (this.daemonProcess) {
      try {
        await this.sendDaemonCommand({ type: 'vm.task.cancel', payload: { taskId: '' } });
      } catch { /* ignore */ }

      this.daemonProcess.kill();
      this.daemonProcess = null;
    }

    // Clean up pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Daemon stopped'));
    }
    this.pendingRequests.clear();

    this.daemonStatus = 'disconnected';
    log('[CareerAgentBridge] Daemon stopped');
  }

  /**
   * Execute a career agent goal
   *
   * This is the main entry point for the career agent. It takes a
   * high-level goal, optionally a plan, and orchestrates execution
   * across the VM with full progress tracking.
   */
  async executeGoal(
    sessionId: string,
    goal: string,
    plan?: CareerAgentPlan,
    metadata?: Partial<CareerAgentMetadata>
  ): Promise<VMTaskResult> {
    log(`[CareerAgentBridge] Executing goal: "${goal}"`);

    // Build full metadata
    const fullMetadata: CareerAgentMetadata = {
      goal,
      plan,
      ...metadata,
    };

    // Convert plan steps to progress tracker steps
    const plannedSteps = plan?.steps.map(s => ({
      title: s.title,
      description: s.description,
      action: s.expectedAction,
    }));

    // Create tracked task
    const task = this.progressTracker.createTask(
      sessionId,
      goal,
      fullMetadata,
      plannedSteps
    );

    // Ensure daemon is running
    await this.startDaemon();

    // Start the task
    this.progressTracker.startTask(task.id);

    try {
      // Execute each step
      for (let i = 0; i < task.steps.length; i++) {
        const step = task.steps[i];

        // Check if task was cancelled
        const currentTask = this.progressTracker.getTask(task.id);
        if (!currentTask || currentTask.status === 'cancelled') {
          return this.progressTracker.completeTask(task.id, 'Task was cancelled');
        }

        // Start step tracking
        this.progressTracker.startStep(task.id, step.id);

        // Execute the step's action
        const result = await this.executeStepAction(step);

        // Update step with result
        if (result.success) {
          this.progressTracker.completeStep(task.id, step.id, result);
        } else {
          this.progressTracker.failStep(task.id, step.id, result.error || 'Action failed');

          // Decide whether to continue or abort
          // For now, abort on first failure
          return this.progressTracker.completeTask(
            task.id,
            `Failed at step ${i + 1}: ${result.error}`,
          );
        }
      }

      // All steps completed
      return this.progressTracker.completeTask(
        task.id,
        `Successfully completed all ${task.steps.length} steps`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.progressTracker.failTask(task.id, errorMsg);

      return {
        taskId: task.id,
        success: false,
        summary: `Task failed: ${errorMsg}`,
        stepsCompleted: task.steps.filter(s => s.status === 'completed').length,
        stepsTotal: task.steps.length,
        totalDuration: Date.now() - task.createdAt,
        error: errorMsg,
      };
    }
  }

  /**
   * Execute a single computer-use action (for direct access)
   */
  async executeAction(
    sessionId: string,
    action: ComputerAction,
    params?: Record<string, unknown>
  ): Promise<ComputerActionResult> {
    // Create a one-off tracked task for this action
    const task = this.progressTracker.createTask(
      sessionId,
      `Execute: ${action}`,
      undefined,
      [{ title: action, action }]
    );

    this.progressTracker.startTask(task.id);
    this.progressTracker.startStep(task.id, task.steps[0].id);

    // Route through the computer use controller
    const request: ComputerActionRequest = {
      id: uuidv4(),
      taskId: task.id,
      stepId: task.steps[0].id,
      action,
      target: params?.target as any,
      text: params?.text as string,
      key: params?.key as string,
      scrollDelta: params?.scrollDelta as number,
      command: params?.command as string,
      captureScreenshot: params?.captureScreenshot as boolean ?? true,
      timeout: params?.timeout as number,
    };

    const result = await this.computerUse.executeAction(request);

    if (result.success) {
      this.progressTracker.completeStep(task.id, task.steps[0].id, result);
      this.progressTracker.completeTask(task.id, `${action} completed`);
    } else {
      this.progressTracker.failStep(task.id, task.steps[0].id, result.error || 'Failed');
      this.progressTracker.failTask(task.id, result.error || 'Action failed');
    }

    return result;
  }

  /**
   * Get the progress tracker (for direct access from session manager)
   */
  getProgressTracker(): VMProgressTracker {
    return this.progressTracker;
  }

  /**
   * Get the computer use controller (for direct access)
   */
  getComputerUseController(): ComputerUseController {
    return this.computerUse;
  }

  /**
   * Get current daemon connection status
   */
  getStatus(): BridgeStatus {
    return this.daemonStatus;
  }

  /**
   * Start the heartbeat monitor
   */
  start(): void {
    this.progressTracker.start();
  }

  /**
   * Shut down the bridge
   */
  async shutdown(): Promise<void> {
    this.progressTracker.stop();
    await this.stopDaemon();
    log('[CareerAgentBridge] Shutdown complete');
  }

  // ==================== Internal: Step Execution ====================

  /**
   * Execute a single step's action based on its type
   */
  private async executeStepAction(step: VMTaskStep): Promise<ComputerActionResult> {
    if (!step.action) {
      // No specific action - return success
      return {
        id: uuidv4(),
        requestId: step.id,
        success: true,
        stdout: 'No action required',
      };
    }

    // If we have a daemon running, route through it
    if (this.daemonProcess && this.daemonStatus === 'connected') {
      return this.executeViaDaemon(step);
    }

    // Otherwise use the computer use controller directly
    const request: ComputerActionRequest = {
      id: uuidv4(),
      taskId: step.taskId,
      stepId: step.id,
      action: step.action as ComputerAction,
      target: step.actionInput?.target as any,
      text: step.actionInput?.text as string,
      key: step.actionInput?.key as string,
      scrollDelta: step.actionInput?.scrollDelta as number,
      command: step.actionInput?.command as string,
      captureScreenshot: true,
    };

    return this.computerUse.executeAction(request);
  }

  /**
   * Execute an action via the VM daemon
   */
  private async executeViaDaemon(step: VMTaskStep): Promise<ComputerActionResult> {
    try {
      const response = await this.sendDaemonRPC('computerAction', {
        action: step.action,
        target: step.actionInput?.target,
        text: step.actionInput?.text,
        key: step.actionInput?.key,
        scrollDelta: step.actionInput?.scrollDelta,
        command: step.actionInput?.command,
        captureScreenshot: true,
      });

      const result = response as any;
      return {
        id: uuidv4(),
        requestId: step.id,
        success: result.success ?? false,
        screenshotBase64: result.screenshotBase64,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        error: result.error,
        duration: result.duration,
      };
    } catch (error) {
      return {
        id: uuidv4(),
        requestId: step.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ==================== Internal: Daemon Management ====================

  /**
   * Resolve the path to the VM agent daemon script
   */
  private resolveDaemonPath(): string {
    if (this.config.daemonScriptPath) {
      return this.config.daemonScriptPath;
    }

    // Look for the compiled daemon script
    const possiblePaths = [
      // Development
      path.join(__dirname, '..', '..', '..', 'dist-electron', 'main', 'vm', 'vm-agent-daemon.js'),
      path.join(__dirname, 'vm-agent-daemon.js'),
      // Production
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist-electron', 'main', 'vm', 'vm-agent-daemon.js'),
    ];

    for (const p of possiblePaths) {
      try {
        const fs = require('fs');
        if (fs.existsSync(p)) {
          return p;
        }
      } catch { /* ignore */ }
    }

    return '';
  }

  /**
   * Start daemon in WSL
   */
  private async startWSLDaemon(daemonPath: string, workspacePath?: string): Promise<boolean> {
    const sandbox = getSandboxAdapter();
    const wslPath = sandbox.resolvePath(daemonPath);

    log(`[CareerAgentBridge] Starting WSL daemon at: ${wslPath}`);

    const distro = sandbox.wslStatus?.distro;
    if (!distro) {
      logError('[CareerAgentBridge] No WSL distro available');
      this.daemonStatus = 'error';
      return false;
    }

    this.daemonProcess = spawn('wsl', [
      '-d', distro,
      '-e', 'node', wslPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return this.setupDaemonProcess(workspacePath);
  }

  /**
   * Start daemon in Lima
   */
  private async startLimaDaemon(daemonPath: string, workspacePath?: string): Promise<boolean> {
    log(`[CareerAgentBridge] Starting Lima daemon at: ${daemonPath}`);

    this.daemonProcess = spawn('limactl', [
      'shell', 'claude-sandbox',
      '--', 'node', daemonPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return this.setupDaemonProcess(workspacePath);
  }

  /**
   * Set up daemon process event handlers and initial handshake
   */
  private async setupDaemonProcess(workspacePath?: string): Promise<boolean> {
    if (!this.daemonProcess) return false;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('[CareerAgentBridge] Daemon start timed out');
        this.daemonStatus = 'error';
        resolve(false);
      }, this.config.daemonStartTimeout);

      // Handle stdout (JSON-RPC responses + EVENT: lines)
      this.daemonProcess!.stdout?.on('data', (data: Buffer) => {
        this.eventBuffer += data.toString();
        this.processEventBuffer();
      });

      // Handle stderr (log messages)
      this.daemonProcess!.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        for (const line of lines) {
          log('[VM Daemon]', line);
        }
      });

      // Handle process exit
      this.daemonProcess!.on('exit', (code) => {
        log(`[CareerAgentBridge] Daemon exited with code: ${code}`);
        this.daemonStatus = 'disconnected';
        this.daemonProcess = null;
      });

      this.daemonProcess!.on('error', (error) => {
        logError('[CareerAgentBridge] Daemon error:', error);
        this.daemonStatus = 'error';
      });

      // Perform initial handshake
      this.sendDaemonRPC('ping', {})
        .then(() => {
          clearTimeout(timeout);
          this.daemonStatus = 'connected';
          log('[CareerAgentBridge] Daemon connected');

          // Set workspace if provided
          if (workspacePath) {
            return this.sendDaemonRPC('setWorkspace', { path: workspacePath });
          }
        })
        .then(() => {
          resolve(true);
        })
        .catch((err) => {
          clearTimeout(timeout);
          logError('[CareerAgentBridge] Handshake failed:', err);
          this.daemonStatus = 'error';
          resolve(false);
        });
    });
  }

  /**
   * Send a JSON-RPC request to the daemon
   */
  private sendDaemonRPC(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.daemonProcess?.stdin?.writable) {
        reject(new Error('Daemon not connected'));
        return;
      }

      const id = uuidv4();
      const request = {
        jsonrpc: '2.0' as const,
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.daemonProcess.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Send a daemon command (fire-and-forget)
   */
  private async sendDaemonCommand(command: VMDaemonCommand): Promise<void> {
    const method = command.type.replace('vm.', '').replace('.', '_');
    await this.sendDaemonRPC(method, command.payload as any);
  }

  /**
   * Process the event buffer for complete JSON lines
   */
  private processEventBuffer(): void {
    const lines = this.eventBuffer.split('\n');
    this.eventBuffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      // Check for EVENT: prefix (daemon events)
      if (line.startsWith('EVENT:')) {
        try {
          const event = JSON.parse(line.slice(6)) as VMDaemonEvent;
          this.progressTracker.handleDaemonEvent(event);
        } catch (err) {
          logWarn('[CareerAgentBridge] Failed to parse daemon event:', line);
        }
        continue;
      }

      // Try to parse as JSON-RPC response
      try {
        const response = JSON.parse(line);
        if (response.id && this.pendingRequests.has(response.id)) {
          const pending = this.pendingRequests.get(response.id)!;
          this.pendingRequests.delete(response.id);
          clearTimeout(pending.timeout);

          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Not JSON - could be a log line from daemon
        log('[VM Daemon stdout]', line);
      }
    }
  }

  // ==================== Internal: Event Forwarding ====================

  /**
   * Forward progress events to the Electron renderer as ServerEvents
   */
  private forwardProgressEvent(event: VMProgressEvent): void {
    if (!this.sendToRenderer) return;

    // Map VMProgressEvents to the existing ServerEvent system
    switch (event.type) {
      case 'vm.progress.taskCreated':
        this.sendToRenderer({
          type: 'trace.step',
          payload: {
            sessionId: event.payload.sessionId,
            step: {
              id: event.payload.task.id,
              type: 'tool_call',
              status: 'pending',
              title: `VM Task: ${event.payload.task.title}`,
              toolName: 'vm_task',
              toolInput: {
                goal: event.payload.task.description,
                steps: event.payload.task.steps.length,
              },
              timestamp: Date.now(),
            },
          },
        });
        break;

      case 'vm.progress.taskUpdated':
        this.sendToRenderer({
          type: 'trace.update',
          payload: {
            sessionId: event.payload.sessionId,
            stepId: event.payload.taskId,
            updates: {
              status: event.payload.snapshot.status === 'running' ? 'running' : 'pending',
              title: `VM Task: ${event.payload.snapshot.title} (${event.payload.snapshot.progress}%)`,
              content: `Step ${event.payload.snapshot.stepsCompleted}/${event.payload.snapshot.stepsTotal}: ${event.payload.snapshot.currentStep || 'Preparing...'}`,
            },
          },
        });
        break;

      case 'vm.progress.stepStarted':
        this.sendToRenderer({
          type: 'trace.step',
          payload: {
            sessionId: event.payload.sessionId,
            step: {
              id: event.payload.step.id,
              type: 'tool_call',
              status: 'running',
              title: event.payload.step.title,
              toolName: event.payload.step.action || 'vm_step',
              toolInput: event.payload.step.actionInput,
              timestamp: Date.now(),
            },
          },
        });
        break;

      case 'vm.progress.stepCompleted':
        this.sendToRenderer({
          type: 'trace.update',
          payload: {
            sessionId: event.payload.sessionId,
            stepId: event.payload.step.id,
            updates: {
              status: 'completed',
              toolOutput: event.payload.step.actionOutput || 'Completed',
              duration: event.payload.step.duration,
            },
          },
        });
        break;

      case 'vm.progress.taskCompleted':
        this.sendToRenderer({
          type: 'trace.update',
          payload: {
            sessionId: event.payload.sessionId,
            stepId: event.payload.taskId,
            updates: {
              status: 'completed',
              title: `VM Task: ${event.payload.result.summary}`,
              toolOutput: `Completed ${event.payload.result.stepsCompleted}/${event.payload.result.stepsTotal} steps in ${event.payload.result.totalDuration}ms`,
              duration: event.payload.result.totalDuration,
            },
          },
        });
        break;

      case 'vm.progress.taskFailed':
        this.sendToRenderer({
          type: 'trace.update',
          payload: {
            sessionId: event.payload.sessionId,
            stepId: event.payload.taskId,
            updates: {
              status: 'error',
              isError: true,
              toolOutput: event.payload.error,
            },
          },
        });
        break;

      case 'vm.progress.screenshot':
        // Screenshots can be sent as part of trace updates
        // The renderer will display them in the trace panel
        this.sendToRenderer({
          type: 'trace.update',
          payload: {
            sessionId: event.payload.sessionId,
            stepId: event.payload.stepId,
            updates: {
              content: `Screenshot captured (step: ${event.payload.stepId})`,
            },
          },
        });
        break;

      case 'vm.progress.heartbeatLost':
        this.sendToRenderer({
          type: 'trace.step',
          payload: {
            sessionId: event.payload.sessionId,
            step: {
              id: `heartbeat-lost-${Date.now()}`,
              type: 'text',
              status: 'error',
              title: 'VM heartbeat lost',
              content: 'The VM daemon is not responding. The task may have stalled.',
              isError: true,
              timestamp: Date.now(),
            },
          },
        });
        break;
    }
  }
}
