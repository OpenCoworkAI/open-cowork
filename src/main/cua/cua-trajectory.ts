/**
 * Trajectory logger for CUA sessions.
 * Records each step as JSONL for post-hoc debugging and analysis.
 * Screenshots are saved as separate PNG files to keep JSONL small.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TrajectoryStep {
  step: number;
  timestamp: string;
  action: {
    type: string;
    params: Record<string, unknown>;
  } | null;  // null for screenshot-only steps
  modelResponse: string;
  actionResult: string;
  screenshotChanged: boolean | null;  // null if not measured
  screenshotDistance: number | null;
  loopNudge: string | null;
  stepBudgetNudge: string | null;
  durationMs: number;
}

export class TrajectoryLogger {
  private sessionDir: string;
  private jsonlPath: string;
  private stepCount = 0;

  constructor(sessionId?: string) {
    const id = sessionId || `cua-${Date.now()}`;
    const baseDir = path.join(
      os.platform() === 'win32'
        ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork')
        : path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork'),
      'cua-trajectories',
      id,
    );
    this.sessionDir = baseDir;
    this.jsonlPath = path.join(baseDir, 'trajectory.jsonl');

    // Create directory synchronously (needed before any async writes)
    fsSync.mkdirSync(baseDir, { recursive: true });
    console.error(`[CUA Trajectory] Logging to ${baseDir}`);
  }

  /** Save a screenshot as a separate PNG file */
  async saveScreenshot(pngBuffer: Buffer, label: string): Promise<string> {
    const filename = `step_${String(this.stepCount).padStart(3, '0')}_${label}.png`;
    const filepath = path.join(this.sessionDir, filename);
    await fs.writeFile(filepath, pngBuffer);
    return filename;
  }

  /** Record a trajectory step */
  async recordStep(step: TrajectoryStep): Promise<void> {
    this.stepCount = step.step;
    const line = JSON.stringify(step) + '\n';
    await fs.appendFile(this.jsonlPath, line);
  }

  /** Get the session directory path (for reporting) */
  getSessionDir(): string {
    return this.sessionDir;
  }

  /** Write a summary at the end of the session */
  async writeSummary(result: { success: boolean; summary: string; totalSteps: number }): Promise<void> {
    const summaryPath = path.join(this.sessionDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify({
      ...result,
      timestamp: new Date().toISOString(),
      trajectoryFile: 'trajectory.jsonl',
    }, null, 2));
  }
}
