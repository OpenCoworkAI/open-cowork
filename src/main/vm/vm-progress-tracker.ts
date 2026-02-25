/**
 * VM Progress Tracker
 *
 * Tracks the progress of career-agent tasks running on VMs.
 * Maintains task state, step history, and provides real-time
 * progress snapshots to the renderer for UI display.
 *
 * This is the host-side service that aggregates events from
 * the VM daemon and exposes them to the Electron renderer.
 */

import { v4 as uuidv4 } from 'uuid';
import { log, logError, logWarn } from '../utils/logger';
import type {
  VMTask,
  VMTaskStep,
  VMTaskStatus,
  VMStepStatus,
  VMProgressSnapshot,
  VMTaskResult,
  VMTaskArtifact,
  ComputerActionResult,
  CareerAgentMetadata,
  VMDaemonEvent,
} from './types';

/** Callback for progress updates sent to the renderer */
export type ProgressUpdateCallback = (event: VMProgressEvent) => void;

/** Events emitted by the progress tracker to the renderer */
export type VMProgressEvent =
  | { type: 'vm.progress.taskCreated'; payload: { sessionId: string; task: VMTask } }
  | { type: 'vm.progress.taskUpdated'; payload: { sessionId: string; taskId: string; snapshot: VMProgressSnapshot } }
  | { type: 'vm.progress.stepStarted'; payload: { sessionId: string; taskId: string; step: VMTaskStep } }
  | { type: 'vm.progress.stepCompleted'; payload: { sessionId: string; taskId: string; step: VMTaskStep } }
  | { type: 'vm.progress.screenshot'; payload: { sessionId: string; taskId: string; stepId: string; screenshotBase64: string } }
  | { type: 'vm.progress.taskCompleted'; payload: { sessionId: string; taskId: string; result: VMTaskResult } }
  | { type: 'vm.progress.taskFailed'; payload: { sessionId: string; taskId: string; error: string } }
  | { type: 'vm.progress.heartbeatLost'; payload: { sessionId: string; taskId: string } };

/** Configuration for the progress tracker */
export interface ProgressTrackerConfig {
  /** How often to check for heartbeat timeouts (ms) */
  heartbeatCheckInterval?: number;
  /** Max time without heartbeat before marking task unhealthy (ms) */
  heartbeatTimeout?: number;
  /** Max number of screenshots to retain per task */
  maxScreenshotsPerTask?: number;
  /** Whether to persist progress to the database */
  persistToDb?: boolean;
}

const DEFAULT_CONFIG: Required<ProgressTrackerConfig> = {
  heartbeatCheckInterval: 5000,
  heartbeatTimeout: 30000,
  maxScreenshotsPerTask: 50,
  persistToDb: false,
};

export class VMProgressTracker {
  private tasks: Map<string, VMTask> = new Map();
  private tasksBySession: Map<string, Set<string>> = new Map();
  private lastHeartbeats: Map<string, number> = new Map();
  private screenshots: Map<string, string[]> = new Map(); // taskId -> base64[]
  private callbacks: Set<ProgressUpdateCallback> = new Set();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: Required<ProgressTrackerConfig>;

  constructor(config?: ProgressTrackerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    log('[VMProgressTracker] Initialized');
  }

  // ==================== Lifecycle ====================

  /** Start the heartbeat monitor */
  start(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.config.heartbeatCheckInterval);

    log('[VMProgressTracker] Heartbeat monitor started');
  }

  /** Stop the heartbeat monitor and clean up */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    log('[VMProgressTracker] Stopped');
  }

  /** Register a callback for progress updates */
  onProgress(callback: ProgressUpdateCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  // ==================== Task Management ====================

  /**
   * Create a new task to track
   */
  createTask(
    sessionId: string,
    title: string,
    metadata?: CareerAgentMetadata,
    plannedSteps?: Array<{ title: string; description?: string; action?: string }>
  ): VMTask {
    const taskId = uuidv4();
    const now = Date.now();

    const steps: VMTaskStep[] = (plannedSteps || []).map((step, index) => ({
      id: uuidv4(),
      taskId,
      index,
      title: step.title,
      description: step.description,
      status: 'pending' as VMStepStatus,
      action: step.action,
    }));

    const task: VMTask = {
      id: taskId,
      sessionId,
      title,
      description: metadata?.goal,
      status: 'queued',
      steps,
      currentStepIndex: 0,
      progress: 0,
      metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, task);

    // Track by session
    if (!this.tasksBySession.has(sessionId)) {
      this.tasksBySession.set(sessionId, new Set());
    }
    this.tasksBySession.get(sessionId)!.add(taskId);

    // Initialize screenshot store
    this.screenshots.set(taskId, []);

    this.emit({ type: 'vm.progress.taskCreated', payload: { sessionId, task } });
    log(`[VMProgressTracker] Task created: ${taskId} "${title}" with ${steps.length} steps`);

    return task;
  }

  /**
   * Start a task (transition from queued/paused to running)
   */
  startTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    task.status = 'running';
    task.updatedAt = Date.now();

    // Start the first pending step if any
    if (task.steps.length > 0 && task.currentStepIndex < task.steps.length) {
      this.startStep(taskId, task.steps[task.currentStepIndex].id);
    }

    this.lastHeartbeats.set(taskId, Date.now());
    this.emitSnapshot(task);
    log(`[VMProgressTracker] Task started: ${taskId}`);
  }

  /**
   * Add a new step dynamically (for tasks that discover steps at runtime)
   */
  addStep(
    taskId: string,
    title: string,
    description?: string,
    action?: string
  ): VMTaskStep | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const step: VMTaskStep = {
      id: uuidv4(),
      taskId,
      index: task.steps.length,
      title,
      description,
      status: 'pending',
      action,
    };

    task.steps.push(step);
    task.updatedAt = Date.now();
    this.recalculateProgress(task);
    this.emitSnapshot(task);

    return step;
  }

  /**
   * Mark a step as started
   */
  startStep(taskId: string, stepId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const step = task.steps.find(s => s.id === stepId);
    if (!step) {
      logWarn(`[VMProgressTracker] Step not found: ${stepId}`);
      return;
    }

    step.status = 'running';
    step.startedAt = Date.now();
    task.currentStepIndex = step.index;
    task.updatedAt = Date.now();

    this.emit({
      type: 'vm.progress.stepStarted',
      payload: { sessionId: task.sessionId, taskId, step },
    });
    this.emitSnapshot(task);
  }

  /**
   * Complete a step with an action result
   */
  completeStep(
    taskId: string,
    stepId: string,
    result?: ComputerActionResult
  ): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const step = task.steps.find(s => s.id === stepId);
    if (!step) {
      logWarn(`[VMProgressTracker] Step not found: ${stepId}`);
      return;
    }

    step.status = 'completed';
    step.completedAt = Date.now();
    step.duration = step.startedAt ? step.completedAt - step.startedAt : undefined;

    if (result) {
      step.actionOutput = result.stdout || (result.success ? 'Success' : result.error);
      if (result.screenshotBase64) {
        step.screenshotBase64 = result.screenshotBase64;
        this.storeScreenshot(taskId, result.screenshotBase64);
      }
      if (result.error) {
        step.error = result.error;
      }
    }

    task.updatedAt = Date.now();
    this.recalculateProgress(task);

    this.emit({
      type: 'vm.progress.stepCompleted',
      payload: { sessionId: task.sessionId, taskId, step },
    });

    // Auto-advance to next step
    const nextIndex = step.index + 1;
    if (nextIndex < task.steps.length && task.status === 'running') {
      this.startStep(taskId, task.steps[nextIndex].id);
    }

    this.emitSnapshot(task);
  }

  /**
   * Fail a step
   */
  failStep(taskId: string, stepId: string, error: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const step = task.steps.find(s => s.id === stepId);
    if (!step) return;

    step.status = 'failed';
    step.error = error;
    step.completedAt = Date.now();
    step.duration = step.startedAt ? step.completedAt - step.startedAt : undefined;
    task.updatedAt = Date.now();
    this.recalculateProgress(task);

    this.emitSnapshot(task);
  }

  /**
   * Complete the entire task
   */
  completeTask(taskId: string, summary?: string, artifacts?: VMTaskArtifact[]): VMTaskResult {
    const task = this.getTask(taskId);
    if (!task) {
      return {
        taskId,
        success: false,
        summary: 'Task not found',
        stepsCompleted: 0,
        stepsTotal: 0,
        totalDuration: 0,
        error: 'Task not found',
      };
    }

    const now = Date.now();
    task.status = 'completed';
    task.completedAt = now;
    task.updatedAt = now;
    task.progress = 100;
    task.totalDuration = now - task.createdAt;

    // Mark any remaining pending steps as skipped
    for (const step of task.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'skipped';
        step.completedAt = now;
      }
    }

    const stepsCompleted = task.steps.filter(s => s.status === 'completed').length;

    const result: VMTaskResult = {
      taskId,
      success: true,
      summary: summary || `Completed ${stepsCompleted}/${task.steps.length} steps`,
      screenshots: this.screenshots.get(taskId),
      stepsCompleted,
      stepsTotal: task.steps.length,
      totalDuration: task.totalDuration,
      artifacts,
    };

    this.emit({
      type: 'vm.progress.taskCompleted',
      payload: { sessionId: task.sessionId, taskId, result },
    });

    this.lastHeartbeats.delete(taskId);
    log(`[VMProgressTracker] Task completed: ${taskId} (${stepsCompleted}/${task.steps.length} steps, ${task.totalDuration}ms)`);

    return result;
  }

  /**
   * Fail the entire task
   */
  failTask(taskId: string, error: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const now = Date.now();
    task.status = 'failed';
    task.error = error;
    task.completedAt = now;
    task.updatedAt = now;
    task.totalDuration = now - task.createdAt;

    this.emit({
      type: 'vm.progress.taskFailed',
      payload: { sessionId: task.sessionId, taskId, error },
    });

    this.lastHeartbeats.delete(taskId);
    logError(`[VMProgressTracker] Task failed: ${taskId} - ${error}`);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task) return;

    const now = Date.now();
    task.status = 'cancelled';
    task.completedAt = now;
    task.updatedAt = now;
    task.totalDuration = now - task.createdAt;

    // Mark running/pending steps as skipped
    for (const step of task.steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'skipped';
        step.completedAt = now;
      }
    }

    this.emitSnapshot(task);
    this.lastHeartbeats.delete(taskId);
    log(`[VMProgressTracker] Task cancelled: ${taskId}`);
  }

  /**
   * Pause a running task
   */
  pauseTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') return;

    task.status = 'paused';
    task.updatedAt = Date.now();
    this.emitSnapshot(task);
    log(`[VMProgressTracker] Task paused: ${taskId}`);
  }

  /**
   * Resume a paused task
   */
  resumeTask(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'paused') return;

    task.status = 'running';
    task.updatedAt = Date.now();
    this.lastHeartbeats.set(taskId, Date.now());
    this.emitSnapshot(task);
    log(`[VMProgressTracker] Task resumed: ${taskId}`);
  }

  // ==================== Screenshot Management ====================

  /**
   * Store a screenshot from a VM action
   */
  storeScreenshot(taskId: string, screenshotBase64: string): void {
    const screenshots = this.screenshots.get(taskId) || [];
    screenshots.push(screenshotBase64);

    // Trim to max
    if (screenshots.length > this.config.maxScreenshotsPerTask) {
      screenshots.splice(0, screenshots.length - this.config.maxScreenshotsPerTask);
    }

    this.screenshots.set(taskId, screenshots);

    const task = this.getTask(taskId);
    if (task) {
      const currentStep = task.steps[task.currentStepIndex];
      this.emit({
        type: 'vm.progress.screenshot',
        payload: {
          sessionId: task.sessionId,
          taskId,
          stepId: currentStep?.id || 'unknown',
          screenshotBase64,
        },
      });
    }
  }

  // ==================== Heartbeat Management ====================

  /**
   * Record a heartbeat from the VM daemon
   */
  recordHeartbeat(taskId: string): void {
    this.lastHeartbeats.set(taskId, Date.now());
  }

  /**
   * Check all active tasks for heartbeat timeouts
   */
  private checkHeartbeats(): void {
    const now = Date.now();

    for (const [taskId, lastHeartbeat] of this.lastHeartbeats) {
      const task = this.getTask(taskId);
      if (!task || task.status !== 'running') continue;

      if (now - lastHeartbeat > this.config.heartbeatTimeout) {
        logWarn(`[VMProgressTracker] Heartbeat lost for task: ${taskId} (last: ${now - lastHeartbeat}ms ago)`);
        this.emit({
          type: 'vm.progress.heartbeatLost',
          payload: { sessionId: task.sessionId, taskId },
        });
      }
    }
  }

  // ==================== Event Handling (from VM daemon) ====================

  /**
   * Handle an event from the VM daemon
   */
  handleDaemonEvent(event: VMDaemonEvent): void {
    switch (event.type) {
      case 'vm.task.created': {
        const { task } = event.payload;
        this.tasks.set(task.id, task);
        if (!this.tasksBySession.has(task.sessionId)) {
          this.tasksBySession.set(task.sessionId, new Set());
        }
        this.tasksBySession.get(task.sessionId)!.add(task.id);
        this.screenshots.set(task.id, []);
        this.emit({
          type: 'vm.progress.taskCreated',
          payload: { sessionId: task.sessionId, task },
        });
        break;
      }

      case 'vm.task.updated': {
        const { taskId, updates } = event.payload;
        const task = this.getTask(taskId);
        if (task) {
          Object.assign(task, updates, { updatedAt: Date.now() });
          this.emitSnapshot(task);
        }
        break;
      }

      case 'vm.task.completed': {
        const { taskId, result } = event.payload;
        const task = this.getTask(taskId);
        if (task) {
          task.status = 'completed';
          task.completedAt = Date.now();
          task.progress = 100;
          this.emit({
            type: 'vm.progress.taskCompleted',
            payload: { sessionId: task.sessionId, taskId, result },
          });
        }
        this.lastHeartbeats.delete(taskId);
        break;
      }

      case 'vm.step.started': {
        const { taskId, step } = event.payload;
        const task = this.getTask(taskId);
        if (task) {
          // Update step in task
          const existingIndex = task.steps.findIndex(s => s.id === step.id);
          if (existingIndex >= 0) {
            task.steps[existingIndex] = step;
          } else {
            task.steps.push(step);
          }
          task.currentStepIndex = step.index;
          task.updatedAt = Date.now();
          this.emit({
            type: 'vm.progress.stepStarted',
            payload: { sessionId: task.sessionId, taskId, step },
          });
          this.emitSnapshot(task);
        }
        break;
      }

      case 'vm.step.completed': {
        const { taskId, stepId, result } = event.payload;
        this.completeStep(taskId, stepId, result);
        break;
      }

      case 'vm.step.failed': {
        const { taskId, stepId, error } = event.payload;
        this.failStep(taskId, stepId, error);
        break;
      }

      case 'vm.screenshot': {
        const { taskId, stepId, screenshotBase64 } = event.payload;
        this.storeScreenshot(taskId, screenshotBase64);
        break;
      }

      case 'vm.progress': {
        // Direct progress snapshot from daemon
        const snapshot = event.payload;
        const task = this.getTask(snapshot.taskId);
        if (task) {
          task.progress = snapshot.progress;
          task.updatedAt = snapshot.updatedAt;
        }
        // Forward as-is to renderer callbacks
        for (const cb of this.callbacks) {
          cb({
            type: 'vm.progress.taskUpdated',
            payload: {
              sessionId: snapshot.sessionId,
              taskId: snapshot.taskId,
              snapshot,
            },
          });
        }
        break;
      }

      case 'vm.heartbeat': {
        this.recordHeartbeat(event.payload.taskId);
        break;
      }

      case 'vm.error': {
        const { taskId, error, recoverable } = event.payload;
        if (!recoverable) {
          this.failTask(taskId, error);
        } else {
          logWarn(`[VMProgressTracker] Recoverable error for task ${taskId}: ${error}`);
        }
        break;
      }
    }
  }

  // ==================== Queries ====================

  /** Get a task by ID */
  getTask(taskId: string): VMTask | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks for a session */
  getTasksForSession(sessionId: string): VMTask[] {
    const taskIds = this.tasksBySession.get(sessionId);
    if (!taskIds) return [];

    return Array.from(taskIds)
      .map(id => this.tasks.get(id))
      .filter((t): t is VMTask => t !== undefined);
  }

  /** Get current progress snapshot for a task */
  getSnapshot(taskId: string): VMProgressSnapshot | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    return this.buildSnapshot(task);
  }

  /** Get all active (running) task snapshots */
  getActiveSnapshots(): VMProgressSnapshot[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'running' || t.status === 'paused')
      .map(t => this.buildSnapshot(t));
  }

  /** Get screenshots for a task */
  getScreenshots(taskId: string): string[] {
    return this.screenshots.get(taskId) || [];
  }

  /** Clean up completed/cancelled tasks older than maxAge (ms) */
  cleanup(maxAge: number = 3600000): void {
    const cutoff = Date.now() - maxAge;
    const toDelete: string[] = [];

    for (const [taskId, task] of this.tasks) {
      if (
        (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
        (task.completedAt || task.updatedAt) < cutoff
      ) {
        toDelete.push(taskId);
      }
    }

    for (const taskId of toDelete) {
      const task = this.tasks.get(taskId);
      if (task) {
        const sessionTasks = this.tasksBySession.get(task.sessionId);
        if (sessionTasks) {
          sessionTasks.delete(taskId);
          if (sessionTasks.size === 0) {
            this.tasksBySession.delete(task.sessionId);
          }
        }
      }
      this.tasks.delete(taskId);
      this.screenshots.delete(taskId);
      this.lastHeartbeats.delete(taskId);
    }

    if (toDelete.length > 0) {
      log(`[VMProgressTracker] Cleaned up ${toDelete.length} old tasks`);
    }
  }

  // ==================== Internal Helpers ====================

  private buildSnapshot(task: VMTask): VMProgressSnapshot {
    const currentStep = task.steps[task.currentStepIndex];
    const screenshots = this.screenshots.get(task.id) || [];

    return {
      taskId: task.id,
      sessionId: task.sessionId,
      title: task.title,
      status: task.status,
      progress: task.progress,
      currentStep: currentStep?.title,
      stepsCompleted: task.steps.filter(s => s.status === 'completed').length,
      stepsTotal: task.steps.length,
      latestScreenshot: screenshots.length > 0 ? screenshots[screenshots.length - 1] : undefined,
      updatedAt: task.updatedAt,
    };
  }

  private recalculateProgress(task: VMTask): void {
    if (task.steps.length === 0) {
      task.progress = task.status === 'completed' ? 100 : 0;
      return;
    }

    const completed = task.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
    task.progress = Math.round((completed / task.steps.length) * 100);
  }

  private emit(event: VMProgressEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch (err) {
        logError('[VMProgressTracker] Callback error:', err);
      }
    }
  }

  private emitSnapshot(task: VMTask): void {
    const snapshot = this.buildSnapshot(task);
    this.emit({
      type: 'vm.progress.taskUpdated',
      payload: { sessionId: task.sessionId, taskId: task.id, snapshot },
    });
  }
}
