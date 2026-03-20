/**
 * Detects when the CUA agent is stuck in a loop (repeating the same actions).
 * Uses action hash comparison with a rolling window.
 */

export interface ActionRecord {
  type: string;        // 'click', 'type_text', etc.
  params: string;      // normalized params as string
  step: number;
}

export class LoopDetector {
  private history: string[] = [];
  private readonly windowSize: number;
  private readonly repeatThreshold: number;

  constructor(windowSize = 10, repeatThreshold = 3) {
    this.windowSize = windowSize;
    this.repeatThreshold = repeatThreshold;
  }

  /**
   * Record an action and check for loops.
   * Returns a nudge message if a loop is detected, null otherwise.
   */
  recordAction(type: string, params: Record<string, unknown>): string | null {
    // Normalize: sort params keys, stringify
    const normalized = `${type}|${JSON.stringify(params, Object.keys(params).sort())}`;
    this.history.push(normalized);

    // Keep only the last windowSize entries
    if (this.history.length > this.windowSize) {
      this.history = this.history.slice(-this.windowSize);
    }

    // Check for consecutive repeats
    const lastAction = this.history[this.history.length - 1];
    let consecutiveCount = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] === lastAction) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= this.repeatThreshold) {
      return `WARNING: You have repeated the same action "${type}" ${consecutiveCount} times in a row. This suggests you are stuck in a loop. Please try a completely different approach to accomplish your goal. Consider: using a different UI element, using keyboard shortcuts instead of clicking, or scrolling to find the correct element.`;
    }

    return null;
  }

  /** Reset the history */
  reset(): void {
    this.history = [];
  }
}
