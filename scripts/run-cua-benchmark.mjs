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

import { execFile, exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_PY = path.join(__dirname, 'cua-helpers', 'cua_helper.py');

// ─── Config ──────────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434';
const MODEL = process.env.CUA_MODEL || 'qwen3.5:4b';
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

// Minimize the parent terminal/Claude Code window so it doesn't block screenshots
let _parentMinimized = false;
async function ensureParentMinimized() {
  if (_parentMinimized) return;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `
$p = (Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}").ParentProcessId
while ($p) {
  $proc = Get-Process -Id $p -EA SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0) {
    Add-Type @"
using System; using System.Runtime.InteropServices;
public class WMin { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
"@
    [WMin]::ShowWindow($proc.MainWindowHandle, 6)
    break
  }
  $p = (Get-CimInstance Win32_Process -Filter "ProcessId = $p" -EA SilentlyContinue).ParentProcessId
}`]);
    _parentMinimized = true;
  } catch {}
}

async function captureScreenshot() {
  await ensureParentMinimized();
  const b64 = await runPy('screenshot', ['--width', String(SCREENSHOT_W), '--height', String(SCREENSHOT_H)]);
  return b64;
}

// Detect if a screenshot is mostly black (locked/off screen)
function isBlackScreen(b64) {
  // A mostly-black screenshot compresses very well → short base64
  // Normal desktop screenshots are typically 200KB+, black screens are <20KB
  return b64.length < 30000;
}

async function captureStableScreenshot(maxWaitMs = 3000) {
  let prev = await captureScreenshot();
  const pollInterval = 500;
  const maxPolls = Math.floor(maxWaitMs / pollInterval);

  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);
    const curr = await captureScreenshot();
    // Compare base64 lengths as a quick stability check
    if (prev.length === curr.length) {
      return curr; // Screen is stable
    }
    prev = curr;
  }
  return prev; // Return last screenshot even if not stable
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
  // Normalize: handle both actual newlines and literal \n sequences from model output
  const normalized = text.replace(/\\n/g, '\n');
  // Handle newlines: split on \n, type each part and press Enter between them
  const lines = normalized.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      const tmpFile = path.join(os.tmpdir(), `cua-type-${Date.now()}.txt`);
      await fs.writeFile(tmpFile, lines[i], 'utf-8');
      try { await runPy('type_text', [tmpFile]); }
      finally { await fs.unlink(tmpFile).catch(() => {}); }
    }
    if (i < lines.length - 1) {
      await runPy('key_press', ['enter']);
      await sleep(200);
    }
  }
  await sleep(200);
  return `Typed: "${text.slice(0, 50)}"`;
}

async function performKeyPress(key, modifiers = []) {
  // Normalize key: "page down" → "pagedown", "page up" → "pageup"
  let normalizedKey = key.toLowerCase().replace(/\s+/g, '');

  // Handle "ctrl+f" style combined keys
  if (normalizedKey.includes('+')) {
    const parts = normalizedKey.split('+');
    normalizedKey = parts.pop(); // last part is the key
    modifiers = [...parts, ...modifiers]; // everything else is a modifier
  }

  // Fix swapped key/modifier: if key is a modifier (ctrl/alt/shift) and modifiers contain a non-modifier, swap them
  const modifierNames = new Set(['ctrl', 'control', 'alt', 'shift']);
  if (modifierNames.has(normalizedKey) && modifiers.length > 0) {
    const nonModMods = modifiers.filter(m => !modifierNames.has(m.toLowerCase()));
    const modMods = modifiers.filter(m => modifierNames.has(m.toLowerCase()));
    if (nonModMods.length > 0) {
      // Swap: the "key" is actually a modifier, and the non-modifier in modifiers is the real key
      modifiers = [normalizedKey, ...modMods];
      normalizedKey = nonModMods[0].toLowerCase().replace(/\s+/g, '');
    }
  }

  await runPy('key_press', [normalizedKey, ...modifiers]);
  await sleep(300);
  return `Pressed: ${modifiers.length ? modifiers.join('+') + '+' : ''}${normalizedKey}`;
}

async function performScroll(mx, my, direction, amount = 3) {
  const { x, y } = mapCoords(mx, my);
  await runPy('scroll', [String(x), String(y), direction, String(amount)]);
  await sleep(200);
  return `Scrolled ${direction} at (${mx},${my})`;
}

// ─── Execute parsed action ──────────────────────────────────────────────────

// Bottom 5% of screen is taskbar — clicks there trigger Start/Search unexpectedly
const TASKBAR_Y = Math.floor(SCREENSHOT_H * 0.95);

function validateClickCoords(x, y) {
  if (isNaN(x) || isNaN(y)) return `Error: invalid coordinates. x and y must be numbers.`;
  if (x < 0 || x > SCREENSHOT_W || y < 0 || y > SCREENSHOT_H) {
    return `Error: (${x},${y}) out of bounds. Valid range: x 0-${SCREENSHOT_W}, y 0-${SCREENSHOT_H}. Consider using type or key_press instead if you're trying to press a button.`;
  }
  if (y > TASKBAR_Y) {
    return `Error: (${x},${y}) is in the taskbar area (y > ${TASKBAR_Y}). Try clicking higher, or use type/key_press to input the character directly.`;
  }
  return null;
}

async function executeAction(action) {
  // Handle nested action objects: {"action": {"action": "screenshot"}} → flatten
  if (typeof action.action === 'object' && action.action !== null) {
    const inner = action.action;
    // If inner has "action" key, use it: {"action": {"action": "click", "x": 100}}
    if (inner.action) {
      return executeAction({ ...action, ...inner, action: inner.action });
    }
    // If inner has "command" but no "action", it's a run_command: {"action": {"command": "ls"}}
    if (inner.command) {
      return executeAction({ ...action, ...inner, action: 'run_command' });
    }
    // If inner has "app", it's a launch_app: {"action": {"app": "edge"}}
    if (inner.app) {
      return executeAction({ ...action, ...inner, action: 'launch_app' });
    }
    // If inner has "path"/"file", it's an open_file: {"action": {"path": "/path/to/file"}}
    if (inner.path || inner.file) {
      return executeAction({ ...action, ...inner, action: 'open_file' });
    }
    // If inner has "key", it's a key_press: {"action": {"key": "enter", "modifiers": ["ctrl"]}}
    if (inner.key) {
      return executeAction({ ...action, ...inner, action: 'key_press' });
    }
    // If inner has "x" and "y", it's a click: {"action": {"x": 100, "y": 200}}
    if (inner.x !== undefined && inner.y !== undefined) {
      return executeAction({ ...action, ...inner, action: 'click' });
    }
    // If inner has "text", it's a type: {"action": {"text": "hello"}}
    if (inner.text) {
      return executeAction({ ...action, ...inner, action: 'type' });
    }
    // If inner has "direction", it's a scroll: {"action": {"direction": "down", "x": 640}}
    if (inner.direction) {
      return executeAction({ ...action, ...inner, action: 'scroll' });
    }
    // If inner has "summary", it's done: {"action": {"summary": "..."}}
    if (inner.summary || inner.done) {
      return { done: true, text: inner.summary || inner.done || 'Task completed.' };
    }
  }

  // Normalize alternative formats the model sometimes uses:
  // {"done": "summary text"} → {"action": "done", "summary": "summary text"}
  if (action.done && !action.action) {
    return { done: true, text: typeof action.done === 'string' ? action.done : action.summary || 'Task completed.' };
  }
  // {"key_press": {"key": "enter"}} → {"action": "key_press", "key": "enter"}
  if (action.key_press && !action.action) {
    const kp = typeof action.key_press === 'object' ? action.key_press : {};
    return executeAction({ action: 'key_press', key: kp.key || action.key, modifiers: kp.modifiers || action.modifiers });
  }

  const type = (typeof action.action === 'string' ? action.action : action.type || '').toLowerCase();

  switch (type) {
    case 'screenshot':
      return { needsScreenshot: true, text: 'Taking screenshot...' };

    case 'click': {
      const x = Number(action.x);
      const y = Number(action.y);
      const err = validateClickCoords(x, y);
      if (err) return { text: err };
      return { text: await performClick(x, y, action.button || 'left') };
    }

    case 'double_click': {
      const x = Number(action.x);
      const y = Number(action.y);
      const err = validateClickCoords(x, y);
      if (err) return { text: err };
      const { x: sx, y: sy } = mapCoords(x, y);
      await runPy('double_click', [String(sx), String(sy)]);
      await sleep(ACTION_SETTLE_MS);
      return { text: `Double-clicked model(${x},${y}) -> screen(${sx},${sy})` };
    }

    case 'right_click': {
      const x = Number(action.x);
      const y = Number(action.y);
      const err = validateClickCoords(x, y);
      if (err) return { text: err };
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
      return { text: await performScroll(sx, sy, action.direction || 'down', action.amount || 5) };
    }

    case 'launch_app':
    case 'launch':
    case 'open_app': {
      const app = action.app || action.name || '';
      if (!app) return { text: 'Error: specify app name. Example: {"action": "launch_app", "app": "calc"}' };
      // Reject generic "settings" — force model to use specific settings pages
      if (app.toLowerCase() === 'settings') {
        return { text: 'Error: "settings" is too generic. Use a specific page: "settings-display", "settings-network", "settings-themes", or "settings-personalization".' };
      }
      await runPy('launch_app', [app]);
      await sleep(1500);
      return { text: `Launched app: ${app}. The window is now maximized and focused.` };
    }

    case 'focus_window': {
      const proc = action.process || action.app || action.name || '';
      if (!proc) return { text: 'Error: specify process name. Example: {"action": "focus_window", "process": "notepad"}' };
      const result = await runPy('focus_window', [proc]);
      if (result.includes('NOT_FOUND')) {
        return { text: `No window found for "${proc}". Use launch_app to open it first.` };
      }
      await sleep(500);
      return { text: `Focused window: ${proc}` };
    }

    case 'view_image': {
      // Read an image file and return it directly to the model's vision input
      // This is faster and more reliable than opening the image in a GUI app
      let imgPath = action.path || action.file || '';
      if (!imgPath) return { text: 'Error: specify image path. Example: {"action": "view_image", "path": "$HOME/Desktop/IMG_001.jpg"}' };
      imgPath = imgPath.replace(/\$HOME/g, os.homedir()).replace(/\$env:USERPROFILE/gi, os.homedir());
      imgPath = imgPath.replace(/\//g, '\\');
      try {
        const imgData = await fs.readFile(imgPath);
        const base64 = imgData.toString('base64');
        return { text: `Viewing image: ${path.basename(imgPath)}`, image: base64 };
      } catch (e) {
        return { text: `Error reading image: ${e.message}` };
      }
    }

    case 'open_file': {
      // Open a file with default app, wait for it to load, maximize, and click content for focus
      let filePath = action.path || action.file || '';
      if (!filePath) return { text: 'Error: specify file path. Example: {"action": "open_file", "path": "$HOME/Desktop/file.pdf"}' };
      // Expand common variables that might not resolve in all contexts
      filePath = filePath.replace(/\$HOME/g, os.homedir()).replace(/\$env:USERPROFILE/gi, os.homedir());
      // Normalize forward slashes to backslashes for Windows
      filePath = filePath.replace(/\//g, '\\');
      try {
        await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Start-Process "${filePath}"`]);
      } catch (e) {
        return { text: `Error opening file: ${e.message}` };
      }
      // Wait for app to start and render (PDF viewers need extra time after Edge restart)
      await sleep(4000);
      // Maximize the foreground window and click center to give content focus
      try {
        // Wake display with a tiny screenshot
        await runPy('screenshot', ['--width', '1', '--height', '1']);
        // Focus the correct app window explicitly
        if (filePath.toLowerCase().endsWith('.pdf')) {
          await runPy('focus_window', ['msedge']).catch(() => {});
        } else if (filePath.toLowerCase().endsWith('.xlsx') || filePath.toLowerCase().endsWith('.xls')) {
          await runPy('focus_window', ['EXCEL']).catch(() => {});
        }
        await sleep(1000);
        // Get foreground window and maximize it
        await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WU {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
[WU]::ShowWindow([WU]::GetForegroundWindow(), 3)
`]);
        await sleep(500);
        // Click center of screen to give content area focus
        const cx = Math.round(SCREENSHOT_W / 2);
        const cy = Math.round(SCREENSHOT_H / 2);
        const { x: sx, y: sy } = mapCoords(cx, cy);
        await runPy('click', [String(sx), String(sy)]);
        await sleep(300);
        // Press Escape to dismiss any popups (Document Recovery, Copilot, etc.)
        await runPy('key_press', ['escape']);
        await sleep(200);
        await runPy('key_press', ['escape']);
        await sleep(200);
      } catch {}
      return { text: `Opened file: ${filePath} (maximized, content focused)` };
    }

    case 'run_command':
    case 'shell':
    case 'exec': {
      let cmd = action.command || action.cmd || '';
      if (!cmd) return { text: 'Error: specify command. Example: {"action": "run_command", "command": "hostname"}' };
      // Convert literal \n to PowerShell newline (`n) inside quoted strings
      // But NOT when \n is part of a path like \nature or \new
      // Only match \n that is NOT followed by a word character (letter/digit/_)
      cmd = cmd.replace(/"([^"]*?)"/g, (match, inner) => {
        return '"' + inner.replace(/\\n(?![a-zA-Z0-9_])/g, '`n') + '"';
      });
      cmd = cmd.replace(/'([^']*?)'/g, (match, inner) => {
        return "'" + inner.replace(/\\n(?![a-zA-Z0-9_])/g, '`n') + "'";
      });
      // Replace $HOME in single quotes (PowerShell doesn't expand variables in single quotes)
      const homeDir = os.homedir().replace(/\\/g, '\\\\');
      cmd = cmd.replace(/'([^']*?)'/g, (match, inner) => {
        return "'" + inner.replace(/\$HOME/g, os.homedir()) + "'";
      });
      try {
        // Use -NoProfile to avoid PSReadLine noise from user's PowerShell profile
        const { stdout, stderr } = await execFileAsync('powershell.exe',
          ['-NoProfile', '-Command', cmd],
          { timeout: 15000, maxBuffer: 1024 * 1024, cwd: os.homedir(), env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
        );
        const out = (stdout || '').trim();
        // Filter out PSReadLine noise that leaks even with -NoProfile in some configs
        const err = (stderr || '').replace(/Set-PSReadLineOption[\s\S]*?FullyQualifiedErrorId[^\r\n]*/g, '').trim();
        let result = '';
        if (out) result += out;
        if (err) result += (result ? '\n[stderr] ' : '[stderr] ') + err;
        if (!result) result = '(no output)';
        // Truncate to prevent context overflow
        if (result.length > 2000) result = result.slice(0, 2000) + '\n... (truncated)';
        return { text: `$ ${cmd}\n${result}` };
      } catch (e) {
        // Filter PSReadLine noise from error output too
        const raw = e.stdout || e.stderr || e.message || 'Command failed';
        const msg = raw.replace(/Set-PSReadLineOption[\s\S]*?FullyQualifiedErrorId[^\r\n]*/g, '').trim();
        return { text: `$ ${cmd}\n[error] ${msg.slice(0, 1000)}` };
      }
    }

    case 'done':
    case 'finish':
    case 'complete':
      return { done: true, text: action.summary || action.result || 'Task completed.' };

    default:
      return { text: `Unknown action: ${type}. Valid: screenshot, click, double_click, right_click, type, key_press, scroll, launch_app, focus_window, open_file, view_image, run_command, done` };
  }
}

// ─── System Prompt (structured JSON output) ──────────────────────────────────

const SYSTEM_PROMPT = `You are a computer use agent on Windows 11. You can see the screen and perform actions to complete tasks.

You MUST respond with a JSON object on a single line. No other text before or after the JSON.
Format: {"thought": "what I observe and my plan", "action": "click", "x": 500, "y": 300}
The "thought" field is REQUIRED — describe what you see and why you chose this action.

Available actions:
1. {"thought": "...", "action": "screenshot"} - Take a screenshot to see the current state
2. {"thought": "...", "action": "click", "x": 300, "y": 200} - Click at coordinates
3. {"thought": "...", "action": "double_click", "x": 300, "y": 200} - Double-click
4. {"thought": "...", "action": "right_click", "x": 300, "y": 200} - Right-click
5. {"thought": "...", "action": "type", "text": "hello"} - Type text via keyboard
6. {"thought": "...", "action": "key_press", "key": "enter", "modifiers": ["ctrl"]} - Press key combo
7. {"thought": "...", "action": "scroll", "x": 300, "y": 200, "direction": "down", "amount": 3}
8. {"thought": "...", "action": "launch_app", "app": "calc"} - Open a GUI application
   Apps: calc, notepad, edge, chrome
   Settings (opens DIRECTLY to the page, no sidebar navigation needed):
     settings-display (Display/resolution), settings-network (Network/WiFi), settings-themes (Themes), settings-personalization
9. {"thought": "...", "action": "focus_window", "process": "notepad"} - Bring an existing window to front
10. {"thought": "...", "action": "run_command", "command": "hostname"} - Run a shell command and get text output
    This runs in PowerShell (-NoProfile) and returns stdout/stderr as text. Use for ANY command-line task:
    system info (hostname, ipconfig), file ops (mkdir, ls, cat, Set-Content), math, web requests, etc.
    You do NOT need to open a terminal window — run_command executes directly and returns the result.
    IMPORTANT: This is Windows PowerShell. "curl" is an alias for Invoke-WebRequest (not Unix curl).
    To download files: Invoke-WebRequest -Uri "https://url" -OutFile "path"
    To make HTTP requests: Invoke-RestMethod "https://url"
    IMPORTANT PowerShell tips:
    - Desktop path: use "$HOME\\Desktop" or "[Environment]::GetFolderPath('Desktop')". Do NOT use "$env:Desktop" (it does not exist).
    - To open a file with default app: Start-Process "$HOME\\Desktop\\file.pdf" (this works!)
    - Edge executable name is "msedge" (NOT "edge"). Example: Start-Process msedge -ArgumentList "https://url"
    - If a command produces no stdout and no error, it SUCCEEDED. Do not retry.
    - "dir /b" does not work in PowerShell. Use: Get-ChildItem -Name
    - IMPORTANT: PowerShell uses backtick-n for newlines, NOT \\n. But the EASIEST way to write multi-line files is:
      Set-Content "$HOME\\Desktop\\data.csv" -Value @("header1,header2","value1,value2","value3,value4")
      Each array element becomes a separate line. Use this for CSV/text files.
11. {"thought": "...", "action": "open_file", "path": "C:\\Users\\me\\Desktop\\file.pdf"} - Open a file with its default app
    This opens the file, waits for the app to load, MAXIMIZES the window, and clicks the center to give content focus.
    Use this instead of Start-Process when you need to VIEW a file (PDF, image, document).
    After open_file, the content area has focus — you can immediately use keyboard shortcuts (Ctrl+F, Page Down, etc.)
12. {"thought": "...", "action": "view_image", "path": "$HOME/Desktop/IMG_001.jpg"} - View an image file directly
    This reads the image and shows it to you WITHOUT opening any app. Much faster than open_file for images.
    Use this to quickly identify what an image shows (food, landscape, chart, receipt, etc.)
    IMPORTANT: Use view_image for classifying images. Use open_file only for PDFs or documents.
13. {"thought": "...", "action": "done", "summary": "Task completed. Result: ..."} - Report completion

CRITICAL rules:
- ALWAYS try run_command FIRST before using any GUI app. run_command is faster, more reliable, and takes 1 step instead of 10+.
  Examples: "Get-ChildItem $HOME\\Desktop" to list files, "mkdir $HOME\\Desktop\\Docs" to create folders, "Move-Item $HOME\\Desktop\\*.txt $HOME\\Desktop\\Docs\\" to move files.
  For downloading files: Invoke-WebRequest -Uri "https://url" -OutFile "$HOME\\Desktop\\file.pdf"
  For VIEWING files (PDFs, images, documents): use open_file action (NOT Start-Process) — it auto-maximizes and gives content focus.
- Only use launch_app + Edge browser when you need to VISUALLY interact with a webpage (click buttons, fill forms, read visual content).
  Do NOT open a browser just to search or download — use run_command with curl instead.
- Do NOT use File Explorer for file operations — use run_command instead (ls, mkdir, mv, cp, cat).
- After launch_app, you can type immediately — it maximizes and focuses the window for you.
- For Settings: ALWAYS use the specific page name ("settings-display", "settings-network", "settings-themes"). Do NOT use generic "settings".
- If a DIFFERENT window appears after your action, use launch_app again to refocus.
  Do NOT use Alt+Tab or click the taskbar — they are unreliable.
- For organizing files: If files have generic names (IMG_xxxx, DSC_xxxx), you MUST look at each image to classify it.
  Use view_image to quickly see what each image shows — it's much faster than open_file.
  Efficient workflow: 1) List files with run_command, 2) view_image each file to see content, 3) create folders + move files with run_command.
  Group files by their VISUAL CONTENT (food, nature, charts, receipts, etc), NOT by file extension.
- For Calculator: ALWAYS type the full expression as one string (e.g., type "25*16="). NEVER click calculator buttons.
  Standard Calculator doesn't support parentheses. To calculate (A+B)*C, type "A+B*C=" (it evaluates left-to-right).
  For advanced math, use run_command: [math]::sqrt(144) or [math]::pow(2,10).
- For Excel/spreadsheet tasks: NEVER type data cell-by-cell in the GUI — it takes too many steps.
  Use run_command with Python openpyxl to create xlsx files WITH charts in a single command:
  python -c "
  import openpyxl; from openpyxl.chart import BarChart, Reference
  wb=openpyxl.Workbook(); ws=wb.active
  for r in [['Name','Score'],['Alice',90],['Bob',85]]: ws.append(r)
  chart=BarChart(); chart.title='Scores'
  vals=Reference(ws,min_col=2,min_row=1,max_row=3)
  cats=Reference(ws,min_col=1,min_row=2,max_row=3)
  chart.add_data(vals,titles_from_data=True); chart.set_categories(cats)
  ws.add_chart(chart,'D2')
  wb.save('C:/Users/USERNAME/Desktop/result.xlsx')
  "
  IMPORTANT: Use forward slashes (/) in Python file paths, NOT backslashes.
  After creating the xlsx, use open_file to open it in Excel so you can see and verify the chart.
  Then report done with a summary of what the chart shows.
- For Edge browser: use Ctrl+L to focus the address bar before typing a URL or search query. Do NOT click the address bar.
- For PDFs in Edge: NEVER use scroll to navigate — it barely moves. Instead:
  1. FIRST click the PDF content area (center of the page) to give it focus
  2. Use Ctrl+F to search for specific text (e.g., search "Table 3" to find a table)
  3. Use Page Down key to move one full page at a time
  4. Click the page number field in the toolbar and type a number to jump to that page
  IMPORTANT: Always click the PDF content BEFORE using any keyboard shortcut (Ctrl+F, Page Down, etc.)
  IMPORTANT: When using Ctrl+F, ALWAYS press Ctrl+A first to select all text in the search box, THEN type your search term.
  This prevents old search text from concatenating with your new search.
- For Notepad Find and Replace (Ctrl+H): type in Find field, press Tab, type in Replace field, then press Alt+A to Replace All.
- Common keyboard shortcuts: Ctrl+S = save file, Ctrl+A = select all, Ctrl+Z = undo, Ctrl+C/V = copy/paste.
- Prefer keyboard input (type, key_press) over clicking buttons in all apps.
- The type action supports newlines: include \\n in text for multi-line content.
- When working across apps (e.g., get system info then write it in Notepad):
  - Step 1: Use run_command to get the info — the result is returned as text.
  - Step 2: Use launch_app to open the GUI app, then type the info you got.
- The screenshot has a CYAN GRID overlay with coordinate labels.
- x: 0 (left) to ${SCREENSHOT_W} (right). y: 0 (top) to ${SCREENSHOT_H} (bottom).
- Include the actual result value in your "done" summary (e.g., "Result: 579").`;

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

  // Fix common model JSON errors and retry
  if (jsonMatch) {
    let fixed = jsonMatch[0];
    // Fix: \"value\" → "value" (escaped quotes around values)
    fixed = fixed.replace(/\\"/g, '"');
    // Fix: double-quoted keys with extra quotes: ""key"" → "key"
    fixed = fixed.replace(/""+/g, '"');
    try { return JSON.parse(fixed); } catch {}
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

// ─── Screenshot Context Pruning ─────────────────────────────────────────────

const MAX_SCREENSHOTS_IN_CONTEXT = 2;

function pruneOldScreenshots(messages) {
  // Find all user messages with images
  const imageMessageIndices = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user' && messages[i].images) {
      imageMessageIndices.push(i);
    }
  }

  // Keep only the last MAX_SCREENSHOTS_IN_CONTEXT images
  if (imageMessageIndices.length > MAX_SCREENSHOTS_IN_CONTEXT) {
    const toRemove = imageMessageIndices.slice(0, -MAX_SCREENSHOTS_IN_CONTEXT);
    for (const idx of toRemove) {
      const msg = messages[idx];
      delete msg.images;
      msg.content = '[Screenshot removed to save context] ' + msg.content;
    }
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

  // Ensure parent terminal is minimized BEFORE any actions
  await ensureParentMinimized();

  const trajectory = new Trajectory();
  const loopDetector = new LoopDetector();
  const reflectionBuffer = []; // Max 3 reflections
  const MAX_REFLECTIONS = 3;
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

      // Step budget awareness (TASK 1c)
      const progressPct = stepCount / maxSteps;
      if (progressPct >= 0.75 && stepCount === Math.ceil(maxSteps * 0.75)) {
        messages.push({
          role: 'user',
          content: `Step ${stepCount}/${maxSteps} -- you are at 75% of your step budget. Prioritize completing the task efficiently. If the task seems impossible, use "done" with a summary of what you accomplished.`
        });
      } else if (progressPct >= 0.5 && stepCount === Math.ceil(maxSteps * 0.5)) {
        messages.push({
          role: 'user',
          content: `Progress check: Step ${stepCount}/${maxSteps}. Briefly assess: what have you accomplished so far, and what remains?`
        });
      }

      // Inject reflection buffer if we have past failures (TASK 2c)
      if (reflectionBuffer.length > 0) {
        const reflectionText = reflectionBuffer.map((r, i) => `${i + 1}. ${r}`).join('\n');
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role === 'user') {
          lastMsg.content = `[PAST FAILURES -- learn from these]\n${reflectionText}\n[END PAST FAILURES]\n\n${lastMsg.content}`;
        }
      }

      // Prune old screenshots to save context (TASK 3b)
      pruneOldScreenshots(messages);

      // Keep display awake during long inference waits
      if (stepCount % 5 === 0) await runPy('wake_display').catch(() => {});

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
      let actionType = (typeof action.action === 'string' ? action.action : action.type || '').toLowerCase();
      // Handle nested action objects
      if (typeof action.action === 'object' && action.action !== null && typeof action.action.action === 'string') {
        actionType = action.action.action.toLowerCase();
      }
      if (actionType === 'done' || actionType === 'finish' || actionType === 'complete') {
        lastSummary = String(action.summary || action.result || rawResponse || '');
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
        // Reflection on loop (TASK 2b)
        const reflection = `Steps ${stepCount-2}-${stepCount}: Repeated "${actionType}" 3+ times with no progress. Need a completely different approach.`;
        reflectionBuffer.push(reflection);
        if (reflectionBuffer.length > MAX_REFLECTIONS) reflectionBuffer.shift();
        // Recovery action menu (TASK 1b)
        messages.push({
          role: 'user',
          content: `You are repeating the same action with no effect. Try one of these recovery strategies:\n\n1. {"thought": "Let me take a fresh screenshot to re-examine", "action": "screenshot"}\n2. {"thought": "Let me press Escape to dismiss any dialog", "action": "key_press", "key": "escape"}\n3. {"thought": "Let me try a keyboard shortcut instead", "action": "key_press", "key": "...", "modifiers": ["ctrl"]}\n4. {"thought": "I am stuck and cannot complete the task", "action": "done", "summary": "Failed: [explain what went wrong]"}\n\nDo NOT repeat the same action again.`,
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
          content: isBlackScreen(b64)
            ? 'The screen appears to be off or locked (black screen). Do NOT try to unlock it. Instead, use run_command and view_image actions which work without the screen. Continue with your task.'
            : 'Here is the current screenshot. Describe what you see briefly, then respond with your next action as JSON.',
          ...(isBlackScreen(b64) ? {} : { images: [b64] }),
        });
      } else {
        const execResult = await executeAction(action);

        if (execResult.done) {
          lastSummary = execResult.text;
          await trajectory.recordStep({
            timestamp: new Date().toISOString(),
            action,
            result: execResult.text,
            model_raw_output: rawResponse,
            model_thought: modelThought,
            duration_ms: Date.now() - stepStartTime,
          }).catch(() => {});
          break;
        }

        // For short type actions (≤5 chars), skip screenshot to avoid
        // per-character overhead when model types one char at a time.
        // For run_command, the result is already text — no screenshot needed.
        const isShortType = (actionType === 'type' || actionType === 'type_text')
          && action.text && action.text.length <= 5;
        const isCommandAction = (actionType === 'run_command' || actionType === 'shell' || actionType === 'exec');
        const isViewImage = (actionType === 'view_image') && execResult.image;

        if (isViewImage) {
          // view_image: send the image file directly to model's vision input (no screen capture needed)
          await trajectory.recordStep({
            timestamp: new Date().toISOString(),
            action,
            result: execResult.text,
            model_raw_output: rawResponse,
            model_thought: modelThought,
            duration_ms: Date.now() - stepStartTime,
          }).catch(() => {});
          messages.push({
            role: 'user',
            content: `${execResult.text}\n\nDescribe what this image shows in detail, then decide which category it belongs to. Respond with your next action as JSON.`,
            images: [execResult.image],
          });
        } else if (isShortType || isCommandAction) {
          await trajectory.recordStep({
            timestamp: new Date().toISOString(),
            action,
            result: execResult.text,
            model_raw_output: rawResponse,
            model_thought: modelThought,
            duration_ms: Date.now() - stepStartTime,
          }).catch(() => {});
          messages.push({
            role: 'user',
            content: isCommandAction
              ? `Command output:\n${execResult.text}\n\nRespond with your next action as JSON.`
              : `Action result: ${execResult.text}\n\nContinue with your next action. You can type multiple characters at once (e.g., "123+456=") to be more efficient.`,
          });
        } else {
          // Full screenshot feedback for all other actions
          const afterB64 = await captureStableScreenshot();
          let afterScreenshotFile = null;
          try {
            afterScreenshotFile = await trajectory.saveScreenshot(afterB64, 'after');
          } catch {}

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
            screenshot_after: afterScreenshotFile,
            duration_ms: Date.now() - stepStartTime,
            model_coords: modelCoords,
            screen_coords: screenCoords,
          }).catch(() => {});

          messages.push({
            role: 'user',
            content: isBlackScreen(afterB64)
              ? `Action result: ${execResult.text}\n\nScreen is off/locked. Use run_command and view_image instead of GUI actions. Continue with your task.`
              : `Action result: ${execResult.text}\n\nHere is a screenshot showing the current state. Analyze what changed and respond with your next action as JSON.`,
            ...(isBlackScreen(afterB64) ? {} : { images: [afterB64] }),
          });
        }
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

// Tasks: goal-only, tests real model autonomy.
// Tier 1: Simple single-app tasks
// Tier 2: Multi-step or cross-app tasks
// Tier 3: Complex real-world scenarios

const TIER1_TASKS = [
  {
    id: 'calc-add',
    name: 'Calculator: addition',
    tier: 1,
    instruction: 'Calculate 123 + 456 and tell me the result.',
    maxSteps: 15,
    validate: (summary) => summary.includes('579'),
  },
  {
    id: 'calc-multiply',
    name: 'Calculator: multiply',
    tier: 1,
    instruction: 'Calculate 25 * 16 and tell me the result.',
    maxSteps: 15,
    validate: (summary) => summary.includes('400'),
  },
  {
    id: 'notepad-write',
    name: 'Notepad: write text',
    tier: 1,
    instruction: 'Open a text editor and type "Hello CUA Test 2026" in it.',
    maxSteps: 12,
    validate: (summary) => summary.toLowerCase().includes('hello') || summary.toLowerCase().includes('typed') || summary.toLowerCase().includes('text'),
  },
  {
    id: 'screenshot-describe',
    name: 'Screen: describe desktop',
    tier: 1,
    instruction: 'Take a screenshot of the current screen and describe what applications and windows are visible.',
    maxSteps: 5,
    validate: (summary) => summary.length > 30,
  },
  {
    id: 'settings-themes',
    name: 'Settings: open themes',
    tier: 1,
    instruction: 'Open the Windows Themes settings page and tell me what themes are available.',
    maxSteps: 10,
    validate: (summary) => summary.toLowerCase().includes('theme') || summary.toLowerCase().includes('setting'),
  },
];

const TIER2_TASKS = [
  {
    id: 'notepad-multiline',
    name: 'Notepad: multi-line',
    tier: 2,
    instruction: 'Write three lines in a text editor: "Line 1", "Line 2", "Line 3", each on its own line.',
    maxSteps: 15,
    validate: (summary) => summary.toLowerCase().includes('line') || summary.toLowerCase().includes('wrote'),
  },
  {
    id: 'calc-chain',
    name: 'Calculator: chain ops',
    tier: 2,
    instruction: 'Calculate (100 + 50) * 2 and tell me the result.',
    maxSteps: 15,
    validate: (summary) => summary.includes('300'),
  },
  {
    id: 'time-check',
    name: 'System: check time',
    tier: 2,
    instruction: 'What is the current time shown on this computer? Read it from the screen.',
    maxSteps: 5,
    validate: (summary) => /\d{1,2}:\d{2}/.test(summary),
  },
  {
    id: 'notepad-save',
    name: 'Notepad: write and save',
    tier: 2,
    instruction: 'Open a text editor, type "CUA saved this file", and save the file with Ctrl+S.',
    maxSteps: 15,
    validate: (summary) => summary.toLowerCase().includes('save'),
  },
  {
    id: 'calc-sqrt',
    name: 'Calculator: square root',
    tier: 2,
    instruction: 'What is the square root of 144? Use any method you want (Calculator, PowerShell, or mental math). Tell me the result.',
    maxSteps: 12,
    validate: (summary) => summary.includes('12'),
  },
  {
    id: 'settings-wifi',
    name: 'Settings: check WiFi',
    tier: 2,
    instruction: 'Open the Network & Internet settings page and tell me the name of the WiFi network this computer is connected to.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      // Accept if summary contains WiFi-related terms OR an actual SSID name (uppercase word)
      return s.includes('wi-fi') || s.includes('wifi') || s.includes('network') || s.includes('connected')
        || /[A-Z]{3,}/.test(summary) || s.includes('msft');
    },
  },
  {
    id: 'notepad-timestamp',
    name: 'Notepad: insert timestamp',
    tier: 2,
    instruction: 'Open Notepad, type today\'s date and current time (read it from the taskbar clock), then tell me what you typed.',
    maxSteps: 12,
    validate: (summary) => /\d{1,2}[\/\-.:]\d{1,2}/.test(summary) || summary.toLowerCase().includes('date') || summary.toLowerCase().includes('time'),
  },
  {
    id: 'notepad-draft-email',
    name: 'Notepad: draft email',
    tier: 2,
    instruction: 'Open Notepad and write a short professional email from Alex to the Team with subject "Weekly Update", briefly summarizing project progress. Include a greeting, body with 2-3 sentences, and a sign-off.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('email') || s.includes('wrote') || s.includes('alex') || s.includes('weekly') || s.includes('draft') || s.includes('typed');
    },
  },
  {
    id: 'settings-display-info',
    name: 'Settings: display info',
    tier: 2,
    instruction: 'Open the Display settings page and tell me the current screen resolution and display scale percentage.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return /\d{3,4}\s*[x×]\s*\d{3,4}/.test(summary) || s.includes('resolution') || s.includes('scale') || s.includes('%');
    },
  },
  {
    id: 'cross-app-time-note',
    name: 'Cross-app: clock to notepad',
    tier: 2,
    instruction: 'Look at the current time shown in the taskbar clock, then open Notepad and type "Time check: " followed by the time you read from the clock.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('time') || /\d{1,2}:\d{2}/.test(summary))
        && (s.includes('notepad') || s.includes('typed') || s.includes('wrote') || s.includes('noted'));
    },
  },
  {
    id: 'calc-percentage',
    name: 'Calculator: percentage',
    tier: 2,
    instruction: 'Use the Calculator to find 15% of 1200. Tell me the result.',
    maxSteps: 12,
    validate: (summary) => summary.includes('180'),
  },
  {
    id: 'notepad-code-snippet',
    name: 'Notepad: code snippet',
    tier: 2,
    instruction: 'Open Notepad and write a simple Python function called "greet" that takes a name parameter and returns "Hello, " followed by the name. Include a complete function definition.',
    maxSteps: 15,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('function') || s.includes('greet') || s.includes('def') || s.includes('python') || s.includes('wrote') || s.includes('typed');
    },
  },
  {
    id: 'powershell-ip-address',
    name: 'PowerShell: IP address',
    tier: 2,
    instruction: 'Open PowerShell and find this computer\'s local IPv4 address. Tell me the IP address.',
    maxSteps: 10,
    validate: (summary) => /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(summary),
  },
  {
    id: 'powershell-username',
    name: 'PowerShell: current user',
    tier: 2,
    instruction: 'Use PowerShell to find the current logged-in Windows username. Tell me the exact username.',
    maxSteps: 8,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('v-') || s.includes('user') || /[a-z][-_a-z0-9]{3,}/i.test(summary);
    },
  },
  {
    id: 'notepad-markdown-doc',
    name: 'Notepad: markdown document',
    tier: 2,
    instruction: 'Open Notepad and write a Markdown document with a "# Project Status" heading, a bullet list of 3 items (Design, Development, Testing), and a line that says "Last updated: March 2026".',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('markdown') || s.includes('document') || s.includes('project') || s.includes('wrote') || s.includes('created') || s.includes('typed'));
    },
  },
];

// Tier 3: Complex real-world productivity scenarios
const TIER3_TASKS = [
  {
    id: 'notepad-find-replace',
    name: 'Notepad: find and replace',
    tier: 3,
    instruction: 'Open Notepad, type "apple banana apple cherry apple", then use Find and Replace (Ctrl+H) to change all "apple" to "orange".',
    maxSteps: 22,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('replace') || s.includes('orange');
    },
  },
  {
    id: 'create-folder',
    name: 'System: create folder',
    tier: 3,
    instruction: 'Create a new folder named "CUA-Test-2026" on the Desktop.',
    maxSteps: 12,
    validate: (summary) => {
      // Best validation: check if folder was actually created
      try {
        for (const dir of ['Desktop', 'Downloads', 'Documents']) {
          if (fss.existsSync(path.join(os.homedir(), dir, 'CUA-Test-2026'))) return true;
        }
      } catch {}
      const s = summary.toLowerCase();
      return s.includes('folder') || s.includes('cua-test') || s.includes('created');
    },
    cleanup: async () => {
      // Clean up from common locations
      for (const dir of ['Desktop', 'Downloads', 'Documents']) {
        const folder = path.join(os.homedir(), dir, 'CUA-Test-2026');
        await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
      }
    },
  },
  {
    id: 'edge-web-search',
    name: 'Edge: web search',
    tier: 3,
    instruction: 'Open the Edge browser and search for "Windows 11 features". Tell me the title and a brief summary of the first search result you see.',
    maxSteps: 15,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('windows') || s.includes('result') || s.includes('search'))
        && s.length > 40;
    },
  },
  {
    id: 'notepad-meeting-agenda',
    name: 'Notepad: meeting agenda',
    tier: 3,
    instruction: 'Create a meeting agenda in Notepad with the title "Team Standup - March 2026", followed by three numbered agenda items about project updates, and an "Action Items" section at the bottom. Use newlines to separate each section.',
    maxSteps: 18,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('agenda') || s.includes('meeting') || s.includes('standup'))
        && (s.includes('wrote') || s.includes('created') || s.includes('typed') || s.includes('completed') || s.includes('done'));
    },
  },
  {
    id: 'powershell-system-info',
    name: 'PowerShell: system info',
    tier: 3,
    instruction: 'Open PowerShell and run a command to find this computer\'s name. Tell me the computer name.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      // Should contain some kind of computer/host name
      return s.length > 10 && (s.includes('computer') || s.includes('name') || s.includes('host') || /[a-z]+-?[a-z0-9]+/i.test(summary));
    },
  },
  {
    id: 'notepad-csv-data',
    name: 'Notepad: CSV data table',
    tier: 3,
    instruction: 'Open Notepad and type a CSV data table with the header line "Name,Department,Salary" followed by 3 rows of sample employee data, each on its own line. Tell me the data you typed.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('csv') || s.includes('data') || s.includes('table') || s.includes('employee') || s.includes('name'))
        && (s.includes('created') || s.includes('wrote') || s.includes('typed') || s.includes('completed') || s.includes('done'));
    },
  },
  {
    id: 'powershell-disk-space',
    name: 'PowerShell: disk space',
    tier: 3,
    instruction: 'Open PowerShell and find the free disk space on C: drive. You can use any command (e.g., fsutil, Get-Volume, wmic). Tell me the free space.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('gb') || s.includes('space') || s.includes('free') || s.includes('disk') || s.includes('byte') || /\d+\s*(gb|tb|mb|byte)/i.test(summary) || /\d{5,}/.test(summary));
    },
  },
  {
    id: 'powershell-web-fetch',
    name: 'PowerShell: fetch webpage',
    tier: 3,
    instruction: 'Use PowerShell to fetch the webpage at https://example.com and tell me the title of the page.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('example') && (s.includes('domain') || s.includes('title') || s.includes('page'));
    },
  },
  {
    id: 'powershell-process-top',
    name: 'PowerShell: top memory process',
    tier: 3,
    instruction: 'Open PowerShell and find the process currently using the most memory. Tell me its name and approximately how much memory it is using in MB.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('process') || s.includes('memory') || s.includes('mb') || s.includes('gb'))
        && s.length > 20;
    },
  },
  {
    id: 'powershell-network-test',
    name: 'PowerShell: network ping',
    tier: 3,
    instruction: 'Open PowerShell and ping microsoft.com once. Tell me if it was successful and what the response time was in milliseconds.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('ms') || s.includes('ping') || s.includes('reply') || s.includes('success') || s.includes('time');
    },
  },
  {
    id: 'powershell-file-listing',
    name: 'PowerShell: list Desktop files',
    tier: 3,
    instruction: 'Open PowerShell and list all files and folders on the Desktop. Tell me how many items are there and name at least two of them.',
    maxSteps: 12,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('file') || s.includes('item') || s.includes('folder') || s.includes('desktop') || /\d+/.test(summary))
        && s.length > 20;
    },
  },
  {
    id: 'cross-app-sysinfo-report',
    name: 'Cross-app: system report in Notepad',
    tier: 3,
    instruction: 'First use PowerShell to find this computer\'s hostname and IP address. Then open Notepad and write a brief "System Report" containing both the hostname and IP address you found.',
    maxSteps: 25,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('report') || s.includes('wrote') || s.includes('notepad') || s.includes('system'))
        && (s.includes('host') || s.includes('name') || s.includes('ip') || /\d+\.\d+\.\d+/.test(summary));
    },
  },
  {
    id: 'cross-app-web-to-notepad',
    name: 'Cross-app: web fetch to Notepad',
    tier: 3,
    instruction: 'Use PowerShell to fetch the title of https://example.com (hint: Invoke-WebRequest). Then open Notepad and type "Web Research Notes:" followed by the title you found.',
    maxSteps: 25,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('example') || s.includes('web') || s.includes('research') || s.includes('title'))
        && (s.includes('notepad') || s.includes('wrote') || s.includes('typed') || s.includes('notes'));
    },
  },
  {
    id: 'edge-visit-url',
    name: 'Edge: navigate to URL',
    tier: 3,
    instruction: 'Open Edge browser, navigate to https://example.com, and describe what the page looks like and what text it contains.',
    maxSteps: 15,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('example') || (s.includes('page') && s.length > 40);
    },
  },
  {
    id: 'powershell-create-run-script',
    name: 'PowerShell: create & run script',
    tier: 3,
    instruction: 'Use PowerShell to create a script file on the Desktop called "hello.ps1" that outputs "Hello from CUA Agent!". Then run that script and tell me the output.',
    maxSteps: 18,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return s.includes('hello') || s.includes('cua') || s.includes('script') || s.includes('output');
    },
    cleanup: async () => {
      const script = path.join(os.homedir(), 'Desktop', 'hello.ps1');
      await fs.unlink(script).catch(() => {});
    },
  },
  {
    id: 'notepad-html-create',
    name: 'Notepad: create HTML page',
    tier: 3,
    instruction: 'Create a file called "demo.html" on the Desktop containing a simple HTML page with a title "CUA Demo", an h1 heading saying "Hello World", and a paragraph. You can use Notepad+Save or PowerShell Set-Content — whichever is easier.',
    maxSteps: 18,
    validate: (summary) => {
      const s = summary.toLowerCase();
      return (s.includes('html') || s.includes('page') || s.includes('demo'))
        && (s.includes('created') || s.includes('saved') || s.includes('wrote') || s.includes('typed'));
    },
    cleanup: async () => {
      const html = path.join(os.homedir(), 'Desktop', 'demo.html');
      await fs.unlink(html).catch(() => {});
    },
  },
  {
    id: 'organize-desktop-files',
    name: 'System: organize messy Desktop',
    tier: 3,
    instruction: 'The Desktop has a bunch of messy files (txt, py, js, json, csv, jpg, png, pdf, docx, pptx, log). Organize them into folders by type — for example, put documents in a "Documents" folder, code files in a "Code" folder, images in an "Images" folder, etc. Use whatever folder names make sense.',
    maxSteps: 30,
    setup: async () => {
      // Always clean first to ensure fresh state (handles interrupted previous runs)
      const messy = path.join(__dirname, 'cua-helpers', 'messy-desktop.ps1');
      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', messy, 'clean']).catch(() => {});
      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', messy, 'create']);
    },
    validate: () => {
      // Directly check filesystem: demo_ files should be in subfolders, not loose on Desktop
      const desktop = path.join(os.homedir(), 'Desktop');
      const prefix = 'demo_';
      try {
        const items = fss.readdirSync(desktop);
        // Count loose demo files still on Desktop
        const looseFiles = items.filter(f => f.startsWith(prefix) && fss.statSync(path.join(desktop, f)).isFile());
        // Find demo files inside subfolders
        const folders = items.filter(f => fss.statSync(path.join(desktop, f)).isDirectory());
        let organizedCount = 0;
        const usedFolders = new Set();
        for (const dir of folders) {
          const dirPath = path.join(desktop, dir);
          const files = fss.readdirSync(dirPath).filter(f => f.startsWith(prefix));
          if (files.length > 0) {
            organizedCount += files.length;
            usedFolders.add(dir);
          }
        }
        console.error(`[VERIFY] Loose: ${looseFiles.length}, Organized: ${organizedCount}, Folders: ${usedFolders.size} (${[...usedFolders].join(', ')})`);
        // Pass: most files organized + at least 3 different folders
        return looseFiles.length <= 8 && organizedCount >= 100 && usedFolders.size >= 3;
      } catch (e) {
        console.error('[VERIFY] Error:', e.message);
        return false;
      }
    },
    cleanup: async () => {
      const messy = path.join(__dirname, 'cua-helpers', 'messy-desktop.ps1');
      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', messy, 'clean']).catch(() => {});
    },
  },
];

// ─── Demo Tasks (for final demo iteration) ───────────────────────────────────

const DEMO_TASKS = [
  {
    id: 'demo-organize-desktop',
    name: 'Demo: organize messy Desktop',
    tier: 'demo',
    instruction: 'My Desktop has a bunch of image files with camera-style names like IMG_xxxx and DSC_xxxx. I have no idea what\'s in them. Please look at each image, figure out what it shows, and organize them into folders by content (e.g. food photos, landscapes, receipts, etc).',
    maxSteps: 50,
    setup: async () => {
      const messy = path.join(__dirname, 'cua-helpers', 'messy-desktop.ps1');
      await execFileAsync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', messy, 'create']);
    },
    validate: (summary) => {
      try {
        const messy = path.join(__dirname, 'cua-helpers', 'messy-desktop.ps1');
        const { status } = require('child_process').spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', messy, 'verify'], { timeout: 10000 });
        return status === 0;
      } catch {}
      return false;
    },
    cleanup: async () => {
      const messy = path.join(__dirname, 'cua-helpers', 'messy-desktop.ps1');
      await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', messy, 'clean']).catch(() => {});
    },
  },
  {
    id: 'demo-paper-chart',
    name: 'Demo: paper ablation → Excel chart',
    tier: 'demo',
    instruction: 'Open the paper "Attention_is_All_You_Need.pdf" on the Desktop. Find the ablation study table (Table 3), read the data, and create a comparison chart in Excel showing the BLEU scores. Save the chart as an xlsx file on the Desktop.',
    maxSteps: 30,
    setup: async () => {
      // Clean up any leftover files from previous runs
      const desktop = path.join(os.homedir(), 'Desktop');
      for (const f of ['paper.pdf', 'attention.pdf', 'chart.xlsx', 'ablation.xlsx', 'ablation_chart.xlsx']) {
        await fs.unlink(path.join(desktop, f)).catch(() => {});
      }
      // Download the paper if not already present
      const pdfPath = path.join(desktop, 'Attention_is_All_You_Need.pdf');
      try {
        await fs.access(pdfPath);
      } catch {
        await execFileAsync('powershell', ['-NoProfile', '-Command',
          `Invoke-WebRequest -Uri "https://arxiv.org/pdf/1706.03762" -OutFile "${pdfPath}"`
        ], { timeout: 30000 });
      }
      // Also close Excel if open
      await execFileAsync('powershell', ['-Command', 'Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force']).catch(() => {});
    },
    validate: (summary) => {
      // Check if any xlsx file with a chart exists on Desktop or common locations
      for (const dir of ['Desktop', 'Documents', 'Downloads', '.']) {
        try {
          const d = dir === '.' ? process.cwd() : path.join(os.homedir(), dir);
          const files = fss.readdirSync(d).filter(f => f.endsWith('.xlsx'));
          for (const f of files) {
            const fp = path.join(d, f);
            const stat = fss.statSync(fp);
            if (Date.now() - stat.mtimeMs > 10 * 60 * 1000) continue; // skip old files
            // Check if xlsx contains a chart using openpyxl
            const result = execFileSync('python', ['-c',
              `import openpyxl; wb=openpyxl.load_workbook("${fp.replace(/\\/g, '/')}"); print(sum(len(ws._charts) for ws in wb.worksheets))`
            ], { timeout: 5000 });
            const charts = parseInt((result || '').toString().trim());
            if (charts > 0) return true;
          }
        } catch {}
      }
      // Fallback: check summary mentions chart/Excel
      const s = (summary || '').toLowerCase();
      return (s.includes('chart') || s.includes('excel') || s.includes('graph') || s.includes('plot'))
        && (s.includes('bleu') || s.includes('ablation') || s.includes('attention') || s.includes('transformer'));
    },
    cleanup: async () => {
      // Close Excel
      await execFileAsync('powershell', ['-Command', 'Get-Process EXCEL -ErrorAction SilentlyContinue | Stop-Process -Force']).catch(() => {});
      // Clean up downloaded PDFs
      const desktop = path.join(os.homedir(), 'Desktop');
      for (const f of ['paper.pdf', 'attention.pdf']) {
        await fs.unlink(path.join(desktop, f)).catch(() => {});
      }
    },
  },
];

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
      // Pre-task: wake display + kill stale apps + clear Notepad session
      try {
        await runPy('wake_display');
        // NOTE: Do NOT kill terminal apps (WindowsTerminal, wt, cmd) — we may be running from one!
        // The model uses run_command instead of GUI terminals anyway.
        const appsToKill = ['CalculatorApp', 'Notepad', 'mspaint', 'SystemSettings', 'msedge', 'WINWORD', 'EXCEL', 'POWERPNT', 'chrome', 'Taskmgr'];
        for (const app of appsToKill) {
          await execFileAsync('taskkill', ['/IM', `${app}.exe`, '/F']).catch(() => {});
        }
        // Clear Windows 11 Notepad tab session to prevent history restoration
        const notepadState = path.join(
          process.env.LOCALAPPDATA || '',
          'Packages', 'Microsoft.WindowsNotepad_8wekyb3d8bbwe', 'LocalState', 'TabState'
        );
        try {
          const files = await fs.readdir(notepadState);
          for (const f of files) {
            await fs.unlink(path.join(notepadState, f)).catch(() => {});
          }
        } catch {}
        // Clear Edge crash recovery state to prevent "Restore pages" dialog
        const edgeState = path.join(
          process.env.LOCALAPPDATA || '',
          'Microsoft', 'Edge', 'User Data', 'Default'
        );
        try {
          for (const f of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
            await fs.unlink(path.join(edgeState, f)).catch(() => {});
          }
          // Mark Edge as having exited cleanly to suppress crash recovery dialog
          const prefsPath = path.join(edgeState, 'Preferences');
          const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
          if (prefs.profile) prefs.profile.exited_cleanly = true;
          if (prefs.profile) prefs.profile.exit_type = 'Normal';
          await fs.writeFile(prefsPath, JSON.stringify(prefs), 'utf8');
        } catch {}
        // Clear Excel auto-recovery files to prevent "Document Recovery" panel
        try {
          const excelRecovery = path.join(process.env.APPDATA || '', 'Microsoft', 'Excel');
          const recoveryFiles = await fs.readdir(excelRecovery).catch(() => []);
          for (const f of recoveryFiles) {
            if (f !== 'XLSTART') await fs.rm(path.join(excelRecovery, f), { recursive: true, force: true }).catch(() => {});
          }
        } catch {}
        // NOTE: Do NOT use Shell.Application COM object to close Explorer windows.
        // It creates a COM reference that causes Explorer to steal focus from subsequent apps.
        // NOTE: Do NOT use minimize_all — it triggers Windows Hello lock screen on corporate Win11.
        // ensureParentMinimized() handles the terminal window separately.
        await sleep(1000);
      } catch {}

      // Keep screen alive: mouse activity prevents Windows Hello from locking
      try { await runPy('scroll', ['640', '400', 'down', '0']); } catch {}

      console.error(`  Run ${i + 1}/${runs}...`);
      // Run task-specific setup if defined
      if (task.setup) {
        try { await task.setup(); } catch (e) { console.error(`[SETUP] ${e.message}`); }
      }
      const t0 = Date.now();
      const result = await runCuaTask(task.instruction, task.maxSteps, task.validate);
      const dur = Date.now() - t0;

      // Cleanup: close common apps between tasks to avoid focus conflicts
      // NOTE: Do NOT kill terminal/shell apps (WindowsTerminal, cmd, powershell) — we run from them!
      try {
        await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
          'Get-Process CalculatorApp,Notepad,mspaint,msedge,chrome,WINWORD,Taskmgr -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue']);
        await sleep(1000);
      } catch {}

      // Per-task cleanup (e.g., remove created folders)
      if (task.cleanup) {
        try { await task.cleanup(); } catch {}
      }

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
    demo: args.includes('--demo'),
  };
}

async function main() {
  const opts = parseArgs();

  console.error('=== CUA Benchmark Runner v2 (JSON mode) ===');
  console.error(`Model: ${MODEL}`);

  // Prevent Windows from locking the screen or sleeping during benchmark
  // Use mouse_event + SetThreadExecutionState to prevent BOTH lock screen and display off
  const wakeScreen = async () => {
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class KA {
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
}
"@
[KA]::SetThreadExecutionState(0x80000003)
[KA]::mouse_event(1, 5, 0, 0, 0)
Start-Sleep -Milliseconds 100
[KA]::mouse_event(1, -5, 0, 0, 0)
`], { timeout: 5000 });
    } catch {}
  };
  await wakeScreen(); // Run immediately to wake screen if it's locked
  const keepAlive = setInterval(wakeScreen, 10000);
  console.error('Screen lock prevention: active (mouse_event + ExecutionState every 10s)');

  if (opts.single) {
    // Pre-task cleanup: kill stale apps (same as runBenchmark)
    const appsToKill = ['CalculatorApp', 'Notepad', 'mspaint', 'SystemSettings', 'msedge', 'WINWORD', 'EXCEL', 'POWERPNT', 'chrome', 'Taskmgr'];
    for (const app of appsToKill) {
      await execFileAsync('taskkill', ['/IM', `${app}.exe`, '/F']).catch(() => {});
    }
    // Clear Edge session state to prevent "Restore pages" dialog and old tabs
    const edgeState = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data', 'Default');
    try {
      for (const f of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
        await fs.unlink(path.join(edgeState, f)).catch(() => {});
      }
      // Mark Edge as having exited cleanly to suppress crash recovery dialog
      const prefsPath = path.join(edgeState, 'Preferences');
      const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf8'));
      if (prefs.profile) prefs.profile.exited_cleanly = true;
      if (prefs.profile) prefs.profile.exit_type = 'Normal';
      await fs.writeFile(prefsPath, JSON.stringify(prefs), 'utf8');
    } catch {}
    // Clear Excel auto-recovery files to prevent "Document Recovery" panel
    try {
      const excelRecovery = path.join(process.env.APPDATA || '', 'Microsoft', 'Excel');
      const recoveryFiles = await fs.readdir(excelRecovery);
      for (const f of recoveryFiles) {
        if (f !== 'XLSTART') await fs.rm(path.join(excelRecovery, f), { recursive: true, force: true }).catch(() => {});
      }
      // Also clear Office unsaved files
      const unsaved = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Office', 'UnsavedFiles');
      const unsavedFiles = await fs.readdir(unsaved).catch(() => []);
      for (const f of unsavedFiles) {
        await fs.rm(path.join(unsaved, f), { force: true }).catch(() => {});
      }
      // Clear Excel DocumentRecovery registry keys
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
        'Remove-Item "HKCU:\\Software\\Microsoft\\Office\\16.0\\Excel\\Resiliency\\DocumentRecovery" -Recurse -Force -ErrorAction SilentlyContinue'
      ]).catch(() => {});
    } catch {}
    await sleep(1000);
    // Pre-task: minimize the current terminal/Claude Code window so it doesn't block screenshots
    try {
      await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `
$myPid = ${process.pid}
$parent = (Get-CimInstance Win32_Process -Filter "ProcessId = $myPid").ParentProcessId
while ($parent) {
  $proc = Get-Process -Id $parent -ErrorAction SilentlyContinue
  if ($proc -and $proc.MainWindowHandle -ne 0) {
    Add-Type @"
using System; using System.Runtime.InteropServices;
public class WinMin { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
"@
    [WinMin]::ShowWindow($proc.MainWindowHandle, 6)
    break
  }
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId = $parent" -ErrorAction SilentlyContinue).ParentProcessId
}
`]);
    } catch {}
    // NOTE: Do NOT use minimize_all — triggers Windows Hello lock screen on corporate Win11.
    // ensureParentMinimized() in captureScreenshot() handles the terminal window.
    await sleep(1000);
    const result = await runCuaTask(opts.single, opts.maxSteps);
    // Restore terminal focus
    try {
      await runPy('minimize_all');
      await sleep(300);
      await runPy('focus_window', ['WindowsTerminal']);
    } catch {}
    console.error(`\nResult: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.error(`Summary: ${result.summary}`);
    console.error(`Steps: ${result.steps}`);
    if (result.trajectoryDir) console.error(`Trajectory: ${result.trajectoryDir}`);
    process.exit(result.success ? 0 : 1);
  }

  let tasks;
  if (opts.demo) {
    tasks = DEMO_TASKS;
    console.error('Mode: DEMO (iterating on final demo tasks)');
  } else if (opts.task) {
    const all = [...TIER1_TASKS, ...TIER2_TASKS, ...TIER3_TASKS, ...DEMO_TASKS];
    const found = all.find(t => t.id === opts.task);
    if (!found) { console.error(`Task not found: ${opts.task}`); process.exit(1); }
    tasks = [found];
  } else if (opts.tier === '2') {
    tasks = TIER2_TASKS;
  } else if (opts.tier === '3') {
    tasks = TIER3_TASKS;
  } else if (opts.tier === 'all') {
    tasks = [...TIER1_TASKS, ...TIER2_TASKS, ...TIER3_TASKS];
  } else {
    tasks = TIER1_TASKS;
  }

  const report = await runBenchmark(tasks, opts.runs, opts.variant);
  console.log(generateReport(report));

  const reportPath = await saveReport(report);
  console.error(`Report saved: ${reportPath}`);

  // Restore terminal focus after benchmark completes
  try {
    await runPy('minimize_all');
    await sleep(500);
    await runPy('focus_window', ['WindowsTerminal']);
  } catch {}
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
