/**
 * VM Progress Tracking & Computer Use Types
 *
 * Shared types for the VM-level progress tracking system
 * and full computer use integration from the Open Claw career agent.
 */

// ============================================================================
// Progress Tracking Types
// ============================================================================

/** High-level status of a career-agent task running on a VM */
export type VMTaskStatus =
  | 'queued'       // Waiting to be picked up
  | 'initializing' // VM is booting / provisioning
  | 'running'      // Actively executing steps
  | 'paused'       // Paused by user or awaiting input
  | 'completed'    // Finished successfully
  | 'failed'       // Terminated with error
  | 'cancelled';   // Cancelled by user

/** Granularity levels for individual steps within a task */
export type VMStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** A single step in a multi-step career agent task */
export interface VMTaskStep {
  id: string;
  taskId: string;
  index: number;
  title: string;
  description?: string;
  status: VMStepStatus;
  /** Tool or action being executed (e.g. 'screenshot', 'click', 'type', 'bash') */
  action?: string;
  /** Input parameters for the action */
  actionInput?: Record<string, unknown>;
  /** Output / result of the action */
  actionOutput?: string;
  /** Screenshot captured during this step (base64) */
  screenshotBase64?: string;
  /** Error message if step failed */
  error?: string;
  startedAt?: number;
  completedAt?: number;
  /** Duration in milliseconds */
  duration?: number;
}

/** A complete task being tracked on a VM */
export interface VMTask {
  id: string;
  sessionId: string;
  /** Human-readable title for the overall task */
  title: string;
  /** Detailed description / goal */
  description?: string;
  status: VMTaskStatus;
  /** Ordered list of steps */
  steps: VMTaskStep[];
  /** Index of the currently executing step */
  currentStepIndex: number;
  /** Overall progress 0-100 */
  progress: number;
  /** Metadata from the career agent */
  metadata?: CareerAgentMetadata;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  /** Total duration in ms */
  totalDuration?: number;
  /** Error message if task failed */
  error?: string;
}

/** Summary snapshot for quick rendering in the UI */
export interface VMProgressSnapshot {
  taskId: string;
  sessionId: string;
  title: string;
  status: VMTaskStatus;
  progress: number;
  currentStep?: string;
  stepsCompleted: number;
  stepsTotal: number;
  /** Most recent screenshot (base64) */
  latestScreenshot?: string;
  updatedAt: number;
}

// ============================================================================
// Computer Use Types
// ============================================================================

/** Supported computer-use actions */
export type ComputerAction =
  | 'screenshot'
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'key'
  | 'scroll'
  | 'move'
  | 'drag'
  | 'wait'
  | 'bash'
  | 'open_app'
  | 'get_screen_info';

/** Target specification for computer use actions */
export interface ComputerTarget {
  /** Screen x coordinate */
  x?: number;
  /** Screen y coordinate */
  y?: number;
  /** Display index for multi-monitor */
  displayIndex?: number;
  /** CSS selector (for browser actions) */
  selector?: string;
  /** Application name */
  appName?: string;
}

/** A computer-use action request sent to the VM */
export interface ComputerActionRequest {
  id: string;
  taskId: string;
  stepId: string;
  action: ComputerAction;
  target?: ComputerTarget;
  /** Text to type */
  text?: string;
  /** Key combination (e.g. 'ctrl+c', 'enter') */
  key?: string;
  /** Scroll delta */
  scrollDelta?: number;
  /** Bash command */
  command?: string;
  /** Whether to capture screenshot after action */
  captureScreenshot?: boolean;
  /** Timeout for this action in ms */
  timeout?: number;
}

/** Result from a computer-use action on the VM */
export interface ComputerActionResult {
  id: string;
  requestId: string;
  success: boolean;
  /** Screenshot captured after action (base64 PNG) */
  screenshotBase64?: string;
  /** Screen dimensions at time of capture */
  screenWidth?: number;
  screenHeight?: number;
  /** Bash command stdout */
  stdout?: string;
  /** Bash command stderr */
  stderr?: string;
  /** Exit code for bash commands */
  exitCode?: number;
  /** Error message if action failed */
  error?: string;
  /** Time taken in ms */
  duration?: number;
}

/** Screen / display info from the VM */
export interface VMDisplayInfo {
  index: number;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

// ============================================================================
// Career Agent Types
// ============================================================================

/** Metadata from the career agent's planning phase */
export interface CareerAgentMetadata {
  /** The original goal / instruction */
  goal: string;
  /** Agent-generated plan with ordered steps */
  plan?: CareerAgentPlan;
  /** Model used for planning */
  model?: string;
  /** Estimated total duration */
  estimatedDuration?: number;
  /** Tags / categories */
  tags?: string[];
}

/** A career agent's plan for accomplishing a goal */
export interface CareerAgentPlan {
  steps: CareerAgentPlanStep[];
  /** Overall strategy description */
  strategy?: string;
  /** Prerequisites that must be met */
  prerequisites?: string[];
}

/** A single step in the career agent's plan */
export interface CareerAgentPlanStep {
  index: number;
  title: string;
  description: string;
  /** Expected action type */
  expectedAction: ComputerAction | 'multi' | 'agent_decision';
  /** Whether this step requires user input/confirmation */
  requiresUserInput?: boolean;
  /** Estimated duration in ms */
  estimatedDuration?: number;
}

// ============================================================================
// VM Events (IPC between VM daemon and host)
// ============================================================================

/** Events sent from the VM daemon to the host */
export type VMDaemonEvent =
  | { type: 'vm.task.created'; payload: { task: VMTask } }
  | { type: 'vm.task.updated'; payload: { taskId: string; updates: Partial<VMTask> } }
  | { type: 'vm.task.completed'; payload: { taskId: string; result: VMTaskResult } }
  | { type: 'vm.step.started'; payload: { taskId: string; step: VMTaskStep } }
  | { type: 'vm.step.completed'; payload: { taskId: string; stepId: string; result: ComputerActionResult } }
  | { type: 'vm.step.failed'; payload: { taskId: string; stepId: string; error: string } }
  | { type: 'vm.screenshot'; payload: { taskId: string; stepId: string; screenshotBase64: string; width: number; height: number } }
  | { type: 'vm.progress'; payload: VMProgressSnapshot }
  | { type: 'vm.error'; payload: { taskId: string; error: string; recoverable: boolean } }
  | { type: 'vm.heartbeat'; payload: { taskId: string; timestamp: number } };

/** Commands sent from the host to the VM daemon */
export type VMDaemonCommand =
  | { type: 'vm.task.start'; payload: { task: VMTask; actions: ComputerActionRequest[] } }
  | { type: 'vm.task.pause'; payload: { taskId: string } }
  | { type: 'vm.task.resume'; payload: { taskId: string } }
  | { type: 'vm.task.cancel'; payload: { taskId: string } }
  | { type: 'vm.action.execute'; payload: ComputerActionRequest }
  | { type: 'vm.screenshot.request'; payload: { taskId: string; displayIndex?: number } }
  | { type: 'vm.heartbeat.request'; payload: { taskId: string } };

/** Final result of a completed task */
export interface VMTaskResult {
  taskId: string;
  success: boolean;
  /** Summary of what was accomplished */
  summary: string;
  /** All screenshots captured during the task */
  screenshots?: string[];
  /** Total steps completed */
  stepsCompleted: number;
  stepsTotal: number;
  totalDuration: number;
  /** Any artifacts produced (file paths, URLs, etc.) */
  artifacts?: VMTaskArtifact[];
  error?: string;
}

/** An artifact produced by a task */
export interface VMTaskArtifact {
  type: 'file' | 'url' | 'text' | 'screenshot';
  name: string;
  value: string;
  mimeType?: string;
}
