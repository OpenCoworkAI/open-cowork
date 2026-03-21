#!/usr/bin/env node
/**
 * CUA Benchmark Runner v2 — Structured JSON output mode (no formal tool calling).
 * Uses direct chat + JSON parsing for more reliable control of small models.
 *
 * Usage:
 *   node scripts/run-cua-benchmark.mjs --task calculator-add
 *   node scripts/run-cua-benchmark.mjs --single "Open Calculator"
 *   node scripts/run-cua-benchmark.mjs --runs 3
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PY = path.join(__dirname, 'cua-helpers', 'cua_helper.py');

// ─── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const MODEL = process.env.CUA_MODEL || 'qwen3.5:9b';
const SCREENSHOT_W = 1280;
const SCREENSHOT_H = 800;
const ACTION_SETTLE_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Python helper wrapper ──────────────────────────────────────────────────

async function runPy(command, args = []) {
  const { stdout, stderr } = await execFileAsync('python', [
    HELPER_PY, command, ...args,
  ], { maxBuffer: 20 * 1024 * 1024 });
  if (stderr && stderr.trim()) console.error(`[PY] ${stderr.trim()}`);
  return stdout.trim();
}

// ─── Screen Info ─────────────────────────────────────────────────────────────

let cachedScreen = null;

async function getScreenInfo() {
  if (cachedScreen) return cachedScreen;
  const output = await runPy('screen_info');
  const [w, h] = output.split(' ').map(Number);
  cachedScreen = { width: w || 1920, height: h || 1080 };
  console.error(`[CUA] Screen: ${cachedScreen.width}x${cachedScreen.height}`);
  return cachedScreen;
}

function mapCoords(mx, my) {
  const screen = cachedScreen || { width: 1920, height: 1080 };
  return {
    x: Math.round(mx * (screen.width / SCREENSHOT_W)),
    y: Math.round(my * (screen.height / SCREENSHOT_H)),
  };
}

// ─── Screenshot ──────────────────────────────────────────────────────────────

async function captureScreenshot() {
  return await runPy('screenshot', ['--width', String(SCREENSHOT_W), '--height', String(SCREENSHOT_H)]);
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function performClick(mx, my, button = 'left') {
  const { x, y } = mapCoords(mx, my);
  await runPy('click', [String(x), String(y), button]);
  await sleep(ACTION_SETTLE_MS);
  return `Clicked model(${mx},${my}) -> screen(${x},${y}) [${button}]`;
}

async function performType(text) {
  if (!text) return 'Error: empty text';
  const tmpFile = path.join(os.tmpdir(), `cua-type-${Date.now()}.txt`);
  await fs.writeFile(tmpFile, text, 'utf-8');
  try { await runPy('type_text', [tmpFile]); }
  finally { await fs.unlink(tmpFile).catch(() => {}); }
  await sleep(200);
  return `Typed: "${text.slice(0, 50)}"`;
}

async function performKeyPress(key, modifiers = []) {
  await runPy('key_press', [key, ...modifiers]);
  await sleep(300);
  return `Pressed: ${modifiers.length ? modifiers.join('+') + '+' : ''}${key}`;
}

async function performScroll(mx, my, direction, amount = 3) {
  const { x, y } = mapCoords(mx, my);
  await runPy('scroll', [String(x), String(y), direction, String(amount)]);
  await sleep(200);
  return `Scrolled ${direction} at (${mx},${my})`;
}

// ─── Execute parsed action ──────────────────────────────────────────────────

async function executeAction(action) {
  const type = (action.action || action.type || '').toLowerCase();

  switch (type) {
    case 'screenshot':
      return { needsScreenshot: true, text: 'Taking screenshot...' };

    case 'click': {
      const x = Number(action.x);
      const y = Number(action.y);
      if (isNaN(x) || isNaN(y)) return { text: `Error: invalid click coordinates x=${action.x}, y=${action.y}` };
      if (x < 0 || x > SCREENSHOT_W || y < 0 || y > SCREENSHOT_H) {
        return { text: `Error: (${x},${y}) out of bounds. Range: 0-${SCREENSHOT_W}, 0-${SCREENSHOT_H}` };
      }
      return { text: await performClick(x, y, action.button || 'left') };
    }

    case 'double_click': {
      const x = Number(action.x);
      const y = Number(action.y);
      if (isNaN(x) || isNaN(y)) return { text: `Error: invalid coords x=${action.x}, y=${action.y}` };
      if (x < 0 || x > SCREENSHOT_W || y < 0 || y > SCREENSHOT_H) {
        return { text: `Error: (${x},${y}) out of bounds. Range: 0-${SCREENSHOT_W}, 0-${SCREENSHOT_H}` };
      }
      const { x: sx, y: sy } = mapCoords(x, y);
      await runPy('double_click', [String(sx), String(sy)]);
      await sleep(ACTION_SETTLE_MS);
      return { text: `Double-clicked model(${x},${y}) -> screen(${sx},${sy})` };
    }

    case 'right_click': {
      const x = Number(action.x);
      const y = Number(action.y);
      if (isNaN(x) || isNaN(y)) return { text: `Error: invalid coords x=${action.x}, y=${action.y}` };
      if (x < 0 || x > SCREENSHOT_W || y < 0 || y > SCREENSHOT_H) {
        return { text: `Error: (${x},${y}) out of bounds. Range: 0-${SCREENSHOT_W}, 0-${SCREENSHOT_H}` };
      }
      const { x: sx, y: sy } = mapCoords(x, y);
      await runPy('right_click', [String(sx), String(sy)]);
      await sleep(ACTION_SETTLE_MS);
      return { text: `Right-clicked model(${x},${y}) -> screen(${sx},${sy})` };
    }

    case 'type':
    case 'type_text':
      return { text: await performType(action.text || '') };

    case 'key_press':
    case 'key':
    case 'hotkey': {
      const key = action.key || '';
      const mods = action.modifiers || [];
      return { text: await performKeyPress(key, Array.isArray(mods) ? mods : [mods]) };
    }

    case 'scroll': {
      const sx = Number(action.x || 640);
      const sy = Number(action.y || 360);
      return { text: await performScroll(sx, sy, action.direction || 'down', action.amount || 3) };
    }

    case 'launch_app':
    case 'launch':
    case 'open_app': {
      const app = action.app || action.name || '';
      if (!app) return { text: 'Error: specify app name. Example: {"action": "launch_app", "app": "calc"}' };
      await runPy('launch_app', [app]);
      await sleep(1500); // Give app time to appear
      return { text: `Launched app: ${app}` };
    }

    case 'done':
    case 'finish':
    case 'complete':
      return { done: true, text: action.summary || action.result || 'Task completed.' };

    default:
      return { text: `Unknown action: ${type}. Valid: screenshot, click, double_click, right_click, type, key_press, scroll, launch_app, done` };
  }
}

// ─── System Prompt (structured JSON output) ──────────────────────────────────

const SYSTEM_PROMPT = `You are a computer use agent on Windows 11. You can see the screen and perform actions.

You MUST respond with a JSON object on a single line. No other text before or after the JSON.
Format: {"thought": "what I observe and my plan", "action": "click", "x": 500, "y": 300}
The "thought" field is REQUIRED — describe what you see and why you chose this action.

Available actions:
1. {"thought": "...", "action": "screenshot"} - Take a screenshot to see the current screen
2. {"thought": "...", "action": "click", "x": 300, "y": 200} - Click at pixel coordinates in the screenshot
3. {"thought": "...", "action": "double_click", "x": 300, "y": 200} - Double-click at pixel coordinates
4. {"thought": "...", "action": "right_click", "x": 300, "y": 200} - Right-click for context menu
5. {"thought": "...", "action": "type", "text": "hello"} - Type text via keyboard (PREFERRED over clicking buttons!)
6. {"thought": "...", "action": "key_press", "key": "enter", "modifiers": ["ctrl"]} - Press key (modifiers: ctrl, alt, shift)
7. {"thought": "...", "action": "scroll", "x": 300, "y": 200, "direction": "down", "amount": 3} - Scroll
8. {"thought": "...", "action": "launch_app", "app": "calc"} - Open an application (calc, notepad, chrome, settings, etc.)
9. {"thought": "...", "action": "done", "summary": "Task completed. Result: ..."} - Report task completion

COORDINATE SYSTEM:
- The screenshot has a CYAN GRID overlay with coordinate labels to help you aim
- x ranges from 0 (left) to ${SCREENSHOT_W} (right)
- y ranges from 0 (top) to ${SCREENSHOT_H} (bottom)
- NEVER output x > ${SCREENSHOT_W} or y > ${SCREENSHOT_H}
- Click the CENTER of the target element
- Use the grid lines and labels to estimate coordinates accurately

KEY RULE — KEYBOARD FIRST:
- ALWAYS prefer typing over clicking when possible!
- Calculator: type "123+456=" instead of clicking buttons
- Text fields: click once to focus, then type the text
- Navigation: use keyboard shortcuts (Ctrl+S, Ctrl+N, Tab, Enter) instead of clicking menus
- Clicking is error-prone — use it only when keyboard input won't work

Other Rules:
- Start with {"thought": "...", "action": "screenshot"} to see the current screen
- Use launch_app to open applications (safer than keyboard shortcuts)
- After each action, check the screenshot to verify it worked
- If an action didn't work (screen unchanged), try a different approach
- When done, use "done" with a summary including any results/answers`;

// ─── Ollama Chat API (no tools, raw chat) ────────────────────────────────────

async function chatRaw(messages) {
  const body = {
    model: MODEL,
    messages,
    stream: false,
    options: { temperature: 0, num_ctx: 8192 },
    keep_alive: '30m',
  };

  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Ollama error ${resp.status}: ${await resp.text()}`);
  return await resp.json();
}

// ─── Parse JSON from model response ──────────────────────────────────────────

function parseAction(text) {
  if (!text || !text.trim()) return null;

  // Try to find JSON in the response
  const cleaned = text.trim();

  // Remove /think blocks
  const noThink = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try direct parse
  try { return JSON.parse(noThink); } catch {}

  // Find first { ... } block
  const jsonMatch = noThink.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }

  // Find JSON in code blocks
  const codeMatch = noThink.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1]); } catch {}
  }

  return null;
}

// ─── Loop Detector ───────────────────────────────────────────────────────────

class LoopDetector {
  constructor() { this.history = []; }
  record(action) {
    const key = JSON.stringify(action);
    this.history.push(key);
    if (this.history.length > 10) this.history = this.history.slice(-10);
    let count = 0;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i] === key) count++; else break;
    }
    return count >= 3;
  }
}

// ─── Trajectory Logger ──────────────────────────────────────────────────────

class Trajectory {
  constructor() {
    const id = `cua-${Date.now()}`;
    this.dir = path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'open-cowork', 'cua-trajectories', id,
    );
    this.jsonlPath = path.join(this.dir, 'trajectory.jsonl');
    this.stepCount = 0;
    this.screenshotIndex = 0;
    this.actionTypeCounts = {};
    this.stepsWithNoScreenChange = 0;
    fss.mkdirSync(this.dir, { recursive: true });
  }
  async saveScreenshot(b64, label) {
    this.screenshotIndex++;
    const ext = 'png';
    const fn = `step_${String(this.screenshotIndex).padStart(3, '0')}_${label}.${ext}`;
    await fs.writeFile(path.join(this.dir, fn), Buffer.from(b64, 'base64'));
    return fn;
  }
  async recordStep(data) {
    this.stepCount++;
    // Track action type counts
    const actionType = data.action?.action || data.action?.type || 'unknown';
    this.actionTypeCounts[actionType] = (this.actionTypeCounts[actionType] || 0) + 1;
    // Track screen changes
    if (data.screen_changed === false) {
      this.stepsWithNoScreenChange++;
    }
    await fs.appendFile(this.jsonlPath, JSON.stringify({ step: this.stepCount, ...data }) + '\n');
  }
  async writeSummary(result) {
    const summary = {
      ...result,
      steps_with_no_screen_change: this.stepsWithNoScreenChange,
      action_type_counts: this.actionTypeCounts,
      timestamp: new Date().toISOString(),
    };
    if (!result.success) {
      summary.failure_analysis = {
        steps_with_no_screen_change: this.stepsWithNoScreenChange,
        action_type_counts: this.actionTypeCounts,
        total_screenshots: this.screenshotIndex,
      };
    }
    await fs.writeFile(path.join(this.dir, 'summary.json'), JSON.stringify(summary, null, 2));
  }
}

// ─── CUA Agent Loop ──────────────────────────────────────────────────────────

async function runCuaTask(instruction, maxSteps = 15, validate = null) {
  console.error(`\n[CUA] Task: ${instruction}`);
  console.error(`[CUA] Max steps: ${maxSteps}`);

  // Health check
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!resp.ok) throw new Error('Not responding');
  } catch (e) {
    return { success: false, summary: `Ollama unavailable: ${e.message}`, steps: 0, failure: 'ollama_unavailable' };
  }

  // Init screen info
  await getScreenInfo();

  const trajectory = new Trajectory();
  const loopDetector = new LoopDetector();
  let stepCount = 0;
  let lastSummary = '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Task: ${instruction}\n\nRespond with your first action as JSON.` },
  ];

  try {
    while (stepCount < maxSteps) {
      stepCount++;
      console.error(`[CUA] Turn ${stepCount}/${maxSteps}`);

      const stepStartTime = Date.now();
      const result = await chatRaw(messages);
      const rawResponse = result.message?.content || '';
      console.error(`[CUA] Model: ${rawResponse.slice(0, 200)}`);

      // Parse JSON action
      const action = parseAction(rawResponse);
      if (!action) {
        console.error('[CUA] Failed to parse action JSON');
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({ role: 'user', content: 'Please respond with a valid JSON action. Example: {"thought": "I need to see the screen", "action": "screenshot"}' });
        continue;
      }

      messages.push({ role: 'assistant', content: rawResponse });

      // Extract thought from parsed action
      const modelThought = action.thought || '';

      // Check for done
      const actionType = (action.action || action.type || '').toLowerCase();
      if (actionType === 'done' || actionType === 'finish' || actionType === 'complete') {
        lastSummary = action.summary || action.result || rawResponse;
        console.error(`[CUA] DONE: ${lastSummary.slice(0, 150)}`);
        await trajectory.recordStep({
          timestamp: new Date().toISOString(),
          action,
          result: lastSummary,
          model_raw_output: rawResponse,
          model_thought: modelThought,
          duration_ms: Date.now() - stepStartTime,
        }).catch(() => {});
        break;
      }

      // Loop detection
      if (actionType !== 'screenshot' && loopDetector.record(action)) {
        console.error('[CUA] Loop detected! Injecting nudge.');
        messages.push({
          role: 'user',
          content: 'You are repeating the same action. Try a COMPLETELY DIFFERENT approach. If stuck, use {"thought": "explanation", "action": "done", "summary": "explanation of what went wrong"}',
        });
        continue;
      }

      // Execute action
      if (actionType === 'screenshot') {
        const b64 = await captureScreenshot();
        await trajectory.saveScreenshot(b64, 'observe').catch(() => {});
        await trajectory.recordStep({
          timestamp: new Date().toISOString(),
          action,
          result: 'Screenshot taken',
          model_raw_output: rawResponse,
          model_thought: modelThought,
          duration_ms: Date.now() - stepStartTime,
        }).catch(() => {});
        messages.push({
          role: 'user',
          content: 'Here is the current screenshot. Describe what you see briefly, then respond with your next action as JSON.',
          images: [b64],
        });
      } else {
        // Capture "before" screenshot for non-screenshot actions
        let beforeScreenshotFile = null;
        let beforeB64 = null;
        try {
          beforeB64 = await captureScreenshot();
          beforeScreenshotFile = await trajectory.saveScreenshot(beforeB64, 'before');
        } catch {}

        const execResult = await executeAction(action);

        if (execResult.done) {
          lastSummary = execResult.text;
          await trajectory.recordStep({
            timestamp: new Date().toISOString(),
            action,
            result: execResult.text,
            model_raw_output: rawResponse,
            model_thought: modelThought,
            screenshot_before: beforeScreenshotFile,
            duration_ms: Date.now() - stepStartTime,
          }).catch(() => {});
          break;
        }

        // Auto-screenshot after every action so model can see the result
        const afterB64 = await captureScreenshot();
        let afterScreenshotFile = null;
        try {
          afterScreenshotFile = await trajectory.saveScreenshot(afterB64, 'after');
        } catch {}

        // Detect screen change by comparing screenshot byte lengths
        const screenChanged = beforeB64 ? (beforeB64.length !== afterB64.length) : null;

        // Extract model coords and screen coords for click-like actions
        let modelCoords = null;
        let screenCoords = null;
        if (['click', 'double_click', 'right_click'].includes(actionType)) {
          const mx = Number(action.x);
          const my = Number(action.y);
          if (!isNaN(mx) && !isNaN(my)) {
            modelCoords = [mx, my];
            const mapped = mapCoords(mx, my);
            screenCoords = [mapped.x, mapped.y];
          }
        }

        await trajectory.recordStep({
          timestamp: new Date().toISOString(),
          action,
          result: execResult.text,
          model_raw_output: rawResponse,
          model_thought: modelThought,
          screenshot_before: beforeScreenshotFile,
          screenshot_after: afterScreenshotFile,
          screen_changed: screenChanged,
          duration_ms: Date.now() - stepStartTime,
          model_coords: modelCoords,
          screen_coords: screenCoords,
        }).catch(() => {});

        messages.push({
          role: 'user',
          content: `Action result: ${execResult.text}\n\nHere is a screenshot showing the current state after the action. Analyze what changed and respond with your next action as JSON.`,
          images: [afterB64],
        });
      }
    }

    const lowerSummary = (lastSummary || '').toLowerCase();
    let success = lastSummary.length > 0 &&
      !lowerSummary.includes('stuck') &&
      !lowerSummary.includes('impossible') &&
      !lowerSummary.includes('failed');

    // Use task-specific validation if provided
    if (success && validate) {
      success = validate(lastSummary);
      if (!success) console.error('[CUA] Task-specific validation failed');
    }

    await trajectory.writeSummary({
      success,
      summary: lastSummary || 'No summary (step budget exhausted)',
      totalSteps: stepCount,
    }).catch(() => {});

    return {
      success,
      summary: lastSummary || 'No summary (step budget exhausted)',
      steps: stepCount,
      trajectoryDir: trajectory.dir,
      failure: !lastSummary ? 'timeout' : (success ? null : 'model_gave_up'),
    };
  } catch (error) {
    console.error('[CUA] Error:', error.message);
    return {
      success: false,
      summary: `Error: ${error.message}`,
      steps: stepCount,
      trajectoryDir: trajectory.dir,
      failure: 'exception',
    };
  }
}

// ─── Benchmark Tasks ─────────────────────────────────────────────────────────

// Tasks are goal-only — no step-by-step instructions.
// The model must autonomously decide how to achieve each goal.
const TIER1_TASKS = [
  {
    id: 'notepad-write',
    name: 'Notepad: write text',
    tier: 1,
    instruction: 'Open a text editor and type "Hello CUA Test 2026" in it.',
    maxSteps: 12,
    validate: (summary) => summary.toLowerCase().includes('hello') || summary.toLowerCase().includes('typed') || summary.toLowerCase().includes('text'),
  },
  {
    id: 'settings-themes',
    name: 'Settings: open themes',
    tier: 1,
    instruction: 'Open the Windows Themes settings page and tell me what themes are available.',
    maxSteps: 10,
    validate: (summary) => summary.toLowerCase().includes('theme') || summary.toLowerCase().includes('setting'),
  },
  {
    id: 'calculator-add',
    name: 'Calculator: addition',
    tier: 1,
    instruction: 'Calculate 123 + 456 and tell me the result.',
    maxSteps: 15,
    validate: (summary) => summary.includes('579'),
  },
];

const TIER2_TASKS = [
  {
    id: 'notepad-multiline',
    name: 'Notepad: multi-line',
    tier: 2,
    instruction: 'Write three lines in a text editor: "Line 1", "Line 2", "Line 3", each on its own line.',
    maxSteps: 15,
    validate: (summary) => summary.toLowerCase().includes('line') || summary.toLowerCase().includes('wrote') || summary.toLowerCase().includes('text'),
  },
  {
    id: 'explorer-desktop',
    name: 'Explorer: Desktop files',
    tier: 2,
    instruction: 'Open File Explorer, go to the Desktop folder, and tell me what files are there.',
    maxSteps: 12,
    validate: (summary) => summary.toLowerCase().includes('desktop') || summary.toLowerCase().includes('file'),
  },
];

// ─── Benchmark Runner ────────────────────────────────────────────────────────

async function runBenchmark(tasks, runs = 1, variant = 'default') {
  console.error(`\n${'='.repeat(60)}`);
  console.error(`CUA Benchmark: ${variant} | ${tasks.length} tasks x ${runs} runs`);
  console.error(`${'='.repeat(60)}\n`);

  const results = [];
  let totalSuccess = 0, totalRuns = 0;

  for (const task of tasks) {
    console.error(`\n--- Task: ${task.name} (Tier ${task.tier}) ---`);
    const taskResults = [];
    let successes = 0;

    for (let i = 0; i < runs; i++) {
      console.error(`  Run ${i + 1}/${runs}...`);
      const t0 = Date.now();
      const result = await runCuaTask(task.instruction, task.maxSteps, task.validate);
      const dur = Date.now() - t0;

      // Cleanup: close common apps between tasks to avoid focus conflicts
      try {
        await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
          'Get-Process CalculatorApp,Notepad,mspaint -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue']);
        await sleep(1000);
      } catch {}

      if (result.success) successes++;
      taskResults.push({ ...result, durationMs: dur, runIndex: i });

      const status = result.success ? 'OK' : `FAIL (${result.failure || 'unknown'})`;
      console.error(`  ${status} - ${result.steps} steps, ${(dur / 1000).toFixed(1)}s`);
    }

    totalSuccess += successes;
    totalRuns += runs;
    results.push({ taskId: task.id, taskName: task.name, tier: task.tier, runs: taskResults, successes, total: runs, rate: successes / runs });
    console.error(`  Result: ${successes}/${runs} (${(successes / runs * 100).toFixed(0)}%)`);
  }

  console.error(`\n${'='.repeat(60)}`);
  console.error(`Overall: ${totalSuccess}/${totalRuns} (${(totalSuccess / totalRuns * 100).toFixed(0)}%)`);
  console.error(`${'='.repeat(60)}\n`);

  return { variant, timestamp: new Date().toISOString(), model: MODEL, results, overall: { total: totalRuns, success: totalSuccess, rate: totalSuccess / totalRuns } };
}

function generateReport(report) {
  const lines = [
    `# CUA Benchmark Report`,
    `**Variant**: ${report.variant}`,
    `**Date**: ${report.timestamp}`,
    `**Model**: ${report.model}`,
    `**Overall**: ${report.overall.success}/${report.overall.total} (${(report.overall.rate * 100).toFixed(0)}%)`,
    '',
    '## Results',
    '',
    '| Task | Tier | Success Rate | Avg Steps | Avg Duration |',
    '|------|------|-------------|-----------|-------------|',
  ];

  for (const t of report.results) {
    const avgSteps = t.runs.reduce((a, r) => a + r.steps, 0) / t.runs.length;
    const avgDur = t.runs.reduce((a, r) => a + r.durationMs, 0) / t.runs.length / 1000;
    lines.push(`| ${t.taskName} | ${t.tier} | ${(t.rate * 100).toFixed(0)}% (${t.successes}/${t.total}) | ${avgSteps.toFixed(1)} | ${avgDur.toFixed(1)}s |`);
  }

  lines.push('', '## Run Details');
  for (const t of report.results) {
    lines.push(`\n### ${t.taskName}`);
    for (const r of t.runs) {
      const status = r.success ? 'OK' : `FAIL ${r.failure || 'unknown'}`;
      lines.push(`- Run ${r.runIndex + 1}: ${status} | ${r.steps} steps | ${(r.durationMs / 1000).toFixed(1)}s`);
      lines.push(`  Summary: ${r.summary.slice(0, 200)}`);
      if (r.trajectoryDir) lines.push(`  Trajectory: \`${r.trajectoryDir}\``);
    }
  }

  return lines.join('\n');
}

async function saveReport(report) {
  const dir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'open-cowork', 'cua-benchmarks',
  );
  await fs.mkdir(dir, { recursive: true });
  const filename = `benchmark-${report.variant}-${report.timestamp.replace(/[:.]/g, '-')}.md`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, generateReport(report));
  return filepath;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      opts[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return {
    runs: parseInt(opts['runs'] || '1', 10),
    task: opts['task'],
    single: opts['single'],
    tier: opts['tier'],
    variant: opts['variant'] || 'baseline-v2',
    maxSteps: parseInt(opts['max-steps'] || '15', 10),
  };
}

async function main() {
  const opts = parseArgs();

  console.error('=== CUA Benchmark Runner v2 (JSON mode) ===');
  console.error(`Model: ${MODEL}`);

  if (opts.single) {
    const result = await runCuaTask(opts.single, opts.maxSteps);
    console.error(`\nResult: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.error(`Summary: ${result.summary}`);
    console.error(`Steps: ${result.steps}`);
    if (result.trajectoryDir) console.error(`Trajectory: ${result.trajectoryDir}`);
    process.exit(result.success ? 0 : 1);
  }

  let tasks;
  if (opts.task) {
    const all = [...TIER1_TASKS, ...TIER2_TASKS];
    const found = all.find(t => t.id === opts.task);
    if (!found) { console.error(`Task not found: ${opts.task}`); process.exit(1); }
    tasks = [found];
  } else if (opts.tier === '2') {
    tasks = TIER2_TASKS;
  } else if (opts.tier === 'all') {
    tasks = [...TIER1_TASKS, ...TIER2_TASKS];
  } else {
    tasks = TIER1_TASKS;
  }

  const report = await runBenchmark(tasks, opts.runs, opts.variant);
  console.log(generateReport(report));

  const reportPath = await saveReport(report);
  console.error(`Report saved: ${reportPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
