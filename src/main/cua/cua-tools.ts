/**
 * @module main/cua/cua-tools
 *
 * Optimized GUI tools for the CUA sub-agent.
 * These are registered as Pi SDK ToolDefinition[] (NOT MCP tools),
 * so ImageContent blocks are passed directly to the model without
 * the MCP bridge stringify bug.
 *
 * Tools: screenshot, click, type_text, key_press, scroll
 *
 * Platform: Windows priority, macOS support.
 *
 * Key design decisions:
 * - Screenshots are resized to 1280×720 before sending to the model
 * - Model outputs coordinates in 1280×720 space
 * - Coordinates are scaled back to real screen space before execution
 * - Windows: DPI-aware via SetProcessDPIAware()
 * - macOS: screencapture + cliclick both use logical points (self-consistent)
 */

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { LoopDetector } from './cua-loop-detector';
import type { TrajectoryLogger } from './cua-trajectory';
import { computeScreenshotFingerprint, fingerprintDistance, UNCHANGED_THRESHOLD } from './cua-screenshot-hash';

const execFileAsync = promisify(execFile);
const PLATFORM = os.platform();

const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 720;

// ─── Screen Info & Coordinate Mapping ───────────────────────────────────────

interface ScreenInfo {
  /** Screen width in the coordinate space used by click APIs */
  width: number;
  /** Screen height in the coordinate space used by click APIs */
  height: number;
}

let cachedScreenInfo: ScreenInfo | null = null;

async function getScreenInfo(): Promise<ScreenInfo> {
  if (cachedScreenInfo) return cachedScreenInfo;

  if (PLATFORM === 'win32') {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System.Runtime.InteropServices;
public class DPI { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[DPI]::SetProcessDPIAware()
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "$($s.Width) $($s.Height)"
`;
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ]);
    const [w, h] = stdout.trim().split(' ').map(Number);
    cachedScreenInfo = { width: w || 1920, height: h || 1080 };
  } else {
    // macOS: capture a quick screenshot to read its LOGICAL dimensions
    // Note: use osascript to get logical bounds, not sips pixelWidth (which returns physical Retina pixels)
    try {
      const { stdout } = await execFileAsync('osascript', ['-e',
        'tell application "Finder" to get bounds of window of desktop',
      ]);
      // Returns "0, 0, 1440, 900" for a Retina MBP
      const parts = stdout.trim().split(/,\s*/);
      if (parts.length >= 4) {
        const w = parseInt(parts[2], 10);
        const h = parseInt(parts[3], 10);
        cachedScreenInfo = { width: w || 1440, height: h || 900 };
      } else {
        cachedScreenInfo = { width: 1440, height: 900 };
      }
    } catch {
      // Fallback to safe defaults if osascript fails
      cachedScreenInfo = { width: 1440, height: 900 };
      console.error('[CUA] Failed to detect macOS screen size, using fallback 1440×900');
    }
  }

  console.error(`[CUA] Screen info: ${cachedScreenInfo.width}×${cachedScreenInfo.height}`);
  return cachedScreenInfo;
}

/**
 * Map model coordinates (in SCREENSHOT_WIDTH×SCREENSHOT_HEIGHT space)
 * to real screen coordinates for the click/scroll APIs.
 */
function mapToScreenCoords(modelX: number, modelY: number, screen: ScreenInfo): { x: number; y: number } {
  return {
    x: Math.round(modelX * (screen.width / SCREENSHOT_WIDTH)),
    y: Math.round(modelY * (screen.height / SCREENSHOT_HEIGHT)),
  };
}

// ─── Screenshot ─────────────────────────────────────────────────────────────

async function captureScreenshot(): Promise<Buffer> {
  if (PLATFORM === 'win32') {
    // #33: Output JPEG Q=85 instead of PNG (80% smaller payload)
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class DPI { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[DPI]::SetProcessDPIAware()
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()
$resized = New-Object System.Drawing.Bitmap($bmp, ${SCREENSHOT_WIDTH}, ${SCREENSHOT_HEIGHT})
$bmp.Dispose()
$ms = New-Object System.IO.MemoryStream
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() | Where-Object { $_.FormatID -eq [System.Drawing.Imaging.ImageFormat]::Jpeg.Guid }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
$resized.Save($ms, $codec, $ep)
$resized.Dispose()
[Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
`;
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { maxBuffer: 20 * 1024 * 1024 });
    return Buffer.from(stdout.trim(), 'base64');
  } else {
    const tmpFile = path.join(os.tmpdir(), `cua-screenshot-${Date.now()}.png`);
    const resizedFile = path.join(os.tmpdir(), `cua-screenshot-${Date.now()}-resized.jpg`);
    try {
      await execFileAsync('/usr/sbin/screencapture', ['-x', '-C', tmpFile]);
      // Resize and convert to JPEG Q=85
      await execFileAsync('/usr/bin/sips', [
        '--resampleWidth', String(SCREENSHOT_WIDTH),
        '--setProperty', 'format', 'jpeg',
        '--setProperty', 'formatOptions', '85',
        '--out', resizedFile,
        tmpFile,
      ]);
      return await fs.readFile(resizedFile);
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
      await fs.unlink(resizedFile).catch(() => {});
    }
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────

const ACTION_SETTLE_MS = 500; // Wait after action for UI to settle

async function performClick(modelX: number, modelY: number, button: string = 'left'): Promise<string> {
  const screen = await getScreenInfo();
  const { x, y } = mapToScreenCoords(modelX, modelY, screen);

  if (PLATFORM === 'win32') {
    const flags = button === 'right' ? '0x0008, 0x0010' : '0x0002, 0x0004';
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[WinInput]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 50
[WinInput]::mouse_event(${flags}, 0, 0, 0, 0)
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else {
    const cliclickPaths = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];
    let clicked = false;
    for (const p of cliclickPaths) {
      try {
        await fs.access(p);
        const cmd = button === 'right' ? 'rc' : 'c';
        await execFileAsync(p, [`${cmd}:${x},${y}`]);
        clicked = true;
        break;
      } catch { /* not found */ }
    }
    if (!clicked) {
      await execFileAsync('osascript', ['-e',
        `tell application "System Events" to click at {${x}, ${y}}`,
      ]);
    }
  }

  await new Promise(r => setTimeout(r, ACTION_SETTLE_MS));
  return `Clicked at model(${modelX},${modelY}) → screen(${x},${y}) [${button}]`;
}

async function performType(text: string): Promise<string> {
  if (!text) return 'Error: empty text';

  // #30: Save clipboard before overwriting, restore after
  const tmpTextFile = path.join(os.tmpdir(), `cua-type-${Date.now()}.txt`);

  if (PLATFORM === 'win32') {
    await fs.writeFile(tmpTextFile, text, 'utf-8');
    try {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
$saved = [System.Windows.Forms.Clipboard]::GetText()
$text = [System.IO.File]::ReadAllText('${tmpTextFile.replace(/\\/g, '\\\\')}')
[System.Windows.Forms.Clipboard]::SetText($text)
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 150
if ($saved) { [System.Windows.Forms.Clipboard]::SetText($saved) }
`;
      await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    } finally {
      await fs.unlink(tmpTextFile).catch(() => {});
    }
  } else {
    // macOS: save clipboard, paste, restore
    let savedClipboard = '';
    try {
      const { stdout } = await execFileAsync('pbpaste', []);
      savedClipboard = stdout;
    } catch { /* empty clipboard */ }

    const { execFile: execFileCb } = await import('child_process');
    await new Promise<void>((resolve, reject) => {
      const proc = execFileCb('pbcopy', [], (err) => err ? reject(err) : resolve());
      proc.stdin?.write(text);
      proc.stdin?.end();
    });
    await execFileAsync('osascript', ['-e',
      'tell application "System Events" to key code 9 using command down',
    ]);

    // Restore clipboard after a short delay
    if (savedClipboard) {
      await new Promise(r => setTimeout(r, 200));
      await new Promise<void>((resolve, reject) => {
        const proc = execFileCb('pbcopy', [], (err) => err ? reject(err) : resolve());
        proc.stdin?.write(savedClipboard);
        proc.stdin?.end();
      });
    }
  }

  await new Promise(r => setTimeout(r, 200));
  return `Typed: "${text.length > 50 ? text.slice(0, 50) + '...' : text}"`;
}

async function performKeyPress(key: string, modifiers: string[] = []): Promise<string> {
  // SAFETY: Block Win key modifier on Windows 11 — it can trigger Windows Hello
  // lock screen via keybd_event, making the machine inaccessible to the CUA agent.
  // Use Start-Process or URI schemes to open apps instead.
  if (PLATFORM === 'win32') {
    const hasWinMod = modifiers.some(m => ['win', 'cmd', 'meta'].includes(m.toLowerCase()));
    if (hasWinMod) {
      return 'Error: Win key is blocked on Windows 11 (can lock screen). Use the launch_app approach instead.';
    }
  }

  if (PLATFORM === 'win32') {
    const vkMap: Record<string, string> = {
      'enter': '0x0D', 'return': '0x0D', 'tab': '0x09', 'escape': '0x1B', 'esc': '0x1B',
      'backspace': '0x08', 'delete': '0x2E', 'space': '0x20',
      'up': '0x26', 'down': '0x28', 'left': '0x25', 'right': '0x27',
      'home': '0x24', 'end': '0x23', 'pageup': '0x21', 'pagedown': '0x22',
      'f1': '0x70', 'f2': '0x71', 'f3': '0x72', 'f4': '0x73', 'f5': '0x74',
      'f6': '0x75', 'f7': '0x76', 'f8': '0x77', 'f9': '0x78', 'f10': '0x79',
      'f11': '0x7A', 'f12': '0x7B',
    };
    const lowerKey = key.toLowerCase();
    const vk = vkMap[lowerKey] || (lowerKey.length === 1 ? `0x${lowerKey.toUpperCase().charCodeAt(0).toString(16)}` : null);

    if (!vk) return `Error: unknown key "${key}". Valid keys: enter, tab, escape, backspace, delete, space, up/down/left/right, f1-f12, a-z`;

    const modDown: string[] = [];
    const modUp: string[] = [];
    for (const mod of modifiers) {
      const m = mod.toLowerCase();
      if (m === 'ctrl' || m === 'control') { modDown.push('[WinInput]::keybd_event(0x11,0,0,0)'); modUp.push('[WinInput]::keybd_event(0x11,0,2,0)'); }
      if (m === 'alt') { modDown.push('[WinInput]::keybd_event(0x12,0,0,0)'); modUp.push('[WinInput]::keybd_event(0x12,0,2,0)'); }
      if (m === 'shift') { modDown.push('[WinInput]::keybd_event(0x10,0,0,0)'); modUp.push('[WinInput]::keybd_event(0x10,0,2,0)'); }
      if (m === 'win' || m === 'cmd' || m === 'meta') { modDown.push('[WinInput]::keybd_event(0x5B,0,0,0)'); modUp.push('[WinInput]::keybd_event(0x5B,0,2,0)'); }
    }

    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
}
"@
${modDown.join('\n')}
[WinInput]::keybd_event(${vk}, 0, 0, 0)
[WinInput]::keybd_event(${vk}, 0, 2, 0)
${modUp.reverse().join('\n')}
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else {
    const keyCodeMap: Record<string, number> = {
      'enter': 36, 'return': 36, 'tab': 48, 'escape': 53, 'esc': 53,
      'backspace': 51, 'delete': 117, 'space': 49,
      'up': 126, 'down': 125, 'left': 123, 'right': 124,
      'home': 115, 'end': 119, 'pageup': 116, 'pagedown': 121,
      'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118, 'f5': 96,
      'f6': 97, 'f7': 98, 'f8': 100, 'f9': 101, 'f10': 109,
      'f11': 103, 'f12': 111,
      'a': 0, 'b': 11, 'c': 8, 'd': 2, 'e': 14, 'f': 3, 'g': 5, 'h': 4,
      'i': 34, 'j': 38, 'k': 40, 'l': 37, 'm': 46, 'n': 45, 'o': 31,
      'p': 35, 'q': 12, 'r': 15, 's': 1, 't': 17, 'u': 32, 'v': 9,
      'w': 13, 'x': 7, 'y': 16, 'z': 6,
    };
    const code = keyCodeMap[key.toLowerCase()];
    if (code === undefined) {
      return `Error: unknown key "${key}". Valid keys: enter, tab, escape, backspace, delete, space, up/down/left/right, f1-f12, a-z`;
    }

    const modMap: Record<string, string> = {
      'cmd': 'command down', 'command': 'command down', 'meta': 'command down',
      'ctrl': 'control down', 'control': 'control down',
      'alt': 'option down', 'option': 'option down',
      'shift': 'shift down',
    };
    const using = modifiers.map(m => modMap[m.toLowerCase()]).filter(Boolean).join(', ');
    const script = using
      ? `tell application "System Events" to key code ${code} using {${using}}`
      : `tell application "System Events" to key code ${code}`;
    await execFileAsync('osascript', ['-e', script]);
  }

  await new Promise(r => setTimeout(r, 300));
  const modStr = modifiers?.length ? modifiers.join('+') + '+' : '';
  return `Pressed: ${modStr}${key}`;
}

async function performScroll(modelX: number, modelY: number, direction: string, amount: number = 3): Promise<string> {
  const validDirections = ['up', 'down', 'left', 'right'];
  if (!validDirections.includes(direction)) {
    return `Error: invalid direction "${direction}". Valid: up, down, left, right`;
  }

  const screen = await getScreenInfo();
  const { x, y } = mapToScreenCoords(modelX, modelY, screen);

  if (PLATFORM === 'win32') {
    // MOUSEEVENTF_WHEEL: positive = scroll up. MOUSEEVENTF_HWHEEL: positive = scroll right.
    const isHorizontal = direction === 'left' || direction === 'right';
    const flag = isHorizontal ? '0x1000' : '0x0800'; // MOUSEEVENTF_HWHEEL / MOUSEEVENTF_WHEEL
    let wheelDelta: number;
    if (isHorizontal) {
      wheelDelta = direction === 'right' ? 120 * amount : -120 * amount;
    } else {
      wheelDelta = direction === 'up' ? 120 * amount : -120 * amount;
    }
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
[WinInput]::SetCursorPos(${x}, ${y})
[WinInput]::mouse_event(${flag}, 0, 0, ${wheelDelta}, 0)
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else {
    // macOS: move mouse then use cliclick scroll or Python Quartz
    const cliclickPaths = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];
    for (const p of cliclickPaths) {
      try {
        await fs.access(p);
        await execFileAsync(p, [`m:${x},${y}`]);
        // cliclick scroll: positive = up, negative = down (for vertical)
        const scrollArg = direction === 'up' ? `su:${amount}` :
                          direction === 'down' ? `sd:${amount}` :
                          direction === 'left' ? `sl:${amount}` : `sr:${amount}`;
        await execFileAsync(p, [scrollArg]);
        await new Promise(r => setTimeout(r, 200));
        return `Scrolled ${direction} at model(${modelX},${modelY}) → screen(${x},${y})`;
      } catch { /* not found, try next */ }
    }
    // Fallback: Python Quartz scroll
    const dy = direction === 'up' ? amount : direction === 'down' ? -amount : 0;
    const dx = direction === 'left' ? amount : direction === 'right' ? -amount : 0;
    const pyScript = `
import Quartz
event = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 2, ${dy}, ${dx})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
`;
    await execFileAsync('python3', ['-c', pyScript]).catch(() => {
      console.error('[CUA] Quartz scroll failed');
    });
  }

  await new Promise(r => setTimeout(r, 200));
  return `Scrolled ${direction} at model(${modelX},${modelY}) → screen(${x},${y})`;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export interface CuaToolsOptions {
  loopDetector?: LoopDetector;
  trajectory?: TrajectoryLogger;
}

/** Last screenshot fingerprint for change detection */
let lastScreenshotFingerprint: string | null = null;

export function buildCuaTools(options: CuaToolsOptions = {}): ToolDefinition[] {
  const { loopDetector, trajectory } = options;

  const screenshotTool: ToolDefinition = {
    name: 'screenshot',
    label: 'Screenshot',
    description: `Take a screenshot of the current screen (${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT} pixels). Always take a screenshot first to see the current state before acting.`,
    parameters: Type.Object({}),
    async execute() {
      const png = await captureScreenshot();

      // Update fingerprint for change detection
      lastScreenshotFingerprint = computeScreenshotFingerprint(png);

      // Save to trajectory if available
      if (trajectory) {
        await trajectory.saveScreenshot(png, 'observe').catch(() => {});
      }

      return {
        content: [
          { type: 'text' as const, text: `Screenshot captured (${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT}). Analyze the screenshot and decide your next action.` },
          { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/jpeg' },
        ],
        details: undefined,
      };
    },
  };

  const clickTool: ToolDefinition = {
    name: 'click',
    label: 'Click',
    description: `Click at coordinates on the ${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT} screenshot. Coordinates are pixel positions in the screenshot image.`,
    parameters: Type.Object({
      x: Type.Number({ description: `X pixel coordinate (0-${SCREENSHOT_WIDTH})` }),
      y: Type.Number({ description: `Y pixel coordinate (0-${SCREENSHOT_HEIGHT})` }),
      button: Type.Optional(Type.String({ description: 'Mouse button: left (default), right' })),
    }),
    async execute(_id, params) {
      const { x, y, button } = params as { x: number; y: number; button?: string };

      // Bounds validation
      if (x < 0 || x > SCREENSHOT_WIDTH || y < 0 || y > SCREENSHOT_HEIGHT) {
        return {
          content: [{ type: 'text' as const, text: `Error: coordinates (${x},${y}) out of bounds. Valid range: x=0-${SCREENSHOT_WIDTH}, y=0-${SCREENSHOT_HEIGHT}. Take a screenshot and try again.` }],
          details: undefined,
        };
      }

      // Loop detection
      const loopNudge = loopDetector?.recordAction('click', { x, y, button: button || 'left' });

      // Remember fingerprint before action
      const beforeFingerprint = lastScreenshotFingerprint;

      const result = await performClick(x, y, button || 'left');

      // Screenshot change detection: take a quick screenshot after click
      const afterPng = await captureScreenshot();
      const afterFingerprint = computeScreenshotFingerprint(afterPng);
      lastScreenshotFingerprint = afterFingerprint;

      let changeInfo = '';
      if (beforeFingerprint && afterFingerprint) {
        const distance = fingerprintDistance(beforeFingerprint, afterFingerprint);
        if (distance < UNCHANGED_THRESHOLD) {
          changeInfo = '\n⚠️ WARNING: The screen appears unchanged after your click. Your click may have missed the target. Take a screenshot to verify, and consider clicking a different position.';
        }
      }

      const messages = [result + changeInfo];
      if (loopNudge) messages.push('\n' + loopNudge);

      // Log to trajectory
      if (trajectory) {
        await trajectory.recordStep({
          timestamp: new Date().toISOString(),
          action: { type: 'click', params: { x, y, button: button || 'left' } },
          modelResponse: '',
          actionResult: result,
          screenshotChanged: changeInfo === '',
          screenshotDistance: beforeFingerprint && afterFingerprint ? fingerprintDistance(beforeFingerprint, afterFingerprint) : null,
          loopNudge: loopNudge || null,
          stepBudgetNudge: null,
          durationMs: 0,
        }).catch(() => {});
      }

      return { content: [{ type: 'text' as const, text: messages.join('') }], details: undefined };
    },
  };

  const typeTool: ToolDefinition = {
    name: 'type_text',
    label: 'Type Text',
    description: 'Type text using the keyboard. Supports ASCII and CJK/Unicode characters. Make sure the target text field is focused (clicked) before typing.',
    parameters: Type.Object({
      text: Type.String({ description: 'Text to type' }),
    }),
    async execute(_id, params) {
      const { text } = params as { text: string };
      const loopNudge = loopDetector?.recordAction('type_text', { text });
      const result = await performType(text);
      const messages = [result];
      if (loopNudge) messages.push('\n' + loopNudge);
      return { content: [{ type: 'text' as const, text: messages.join('') }], details: undefined };
    },
  };

  const keyPressTool: ToolDefinition = {
    name: 'key_press',
    label: 'Key Press',
    description: 'Press a key with optional modifiers. Keys: enter, tab, escape, backspace, delete, space, up/down/left/right, home, end, pageup, pagedown, f1-f12, a-z. Modifiers: ctrl, alt, shift, cmd/win.',
    parameters: Type.Object({
      key: Type.String({ description: 'Key name (e.g., "enter", "a", "f5")' }),
      modifiers: Type.Optional(Type.Array(Type.String(), { description: 'Modifier keys, e.g. ["ctrl"], ["ctrl","shift"]' })),
    }),
    async execute(_id, params) {
      const { key, modifiers } = params as { key: string; modifiers?: string[] };
      const loopNudge = loopDetector?.recordAction('key_press', { key, modifiers: modifiers || [] });
      const result = await performKeyPress(key, modifiers || []);
      const messages = [result];
      if (loopNudge) messages.push('\n' + loopNudge);
      return { content: [{ type: 'text' as const, text: messages.join('') }], details: undefined };
    },
  };

  const scrollTool: ToolDefinition = {
    name: 'scroll',
    label: 'Scroll',
    description: `Scroll at a position on the ${SCREENSHOT_WIDTH}×${SCREENSHOT_HEIGHT} screenshot. Move mouse to position first, then scroll.`,
    parameters: Type.Object({
      x: Type.Number({ description: 'X coordinate to scroll at' }),
      y: Type.Number({ description: 'Y coordinate to scroll at' }),
      direction: Type.String({ description: 'Scroll direction: up, down, left, right' }),
      amount: Type.Optional(Type.Number({ description: 'Scroll amount in lines (default: 3)' })),
    }),
    async execute(_id, params) {
      const { x, y, direction, amount } = params as { x: number; y: number; direction: string; amount?: number };
      const loopNudge = loopDetector?.recordAction('scroll', { x, y, direction });
      const result = await performScroll(x, y, direction, amount || 3);
      const messages = [result];
      if (loopNudge) messages.push('\n' + loopNudge);
      return { content: [{ type: 'text' as const, text: messages.join('') }], details: undefined };
    },
  };

  const launchAppTool: ToolDefinition = {
    name: 'launch_app',
    label: 'Launch App',
    description: 'Open a Windows application by name. Much safer than using Win key shortcuts (which can lock the screen on Windows 11). Common names: calc, notepad, mspaint, explorer, chrome, msedge, code. For Settings, use URI like "ms-settings:" or "ms-settings:themes".',
    parameters: Type.Object({
      app: Type.String({ description: 'App name or path (e.g., "calc", "notepad", "ms-settings:themes")' }),
    }),
    async execute(_id, params) {
      const { app } = params as { app: string };
      const appMap: Record<string, string> = {
        calculator: 'calc', calc: 'calc',
        notepad: 'notepad', paint: 'mspaint',
        explorer: 'explorer', chrome: 'chrome',
        edge: 'msedge', settings: 'ms-settings:',
      };
      const resolved = appMap[app.toLowerCase()] || app;

      try {
        if (PLATFORM === 'win32') {
          if (resolved.startsWith('ms-')) {
            await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process "${resolved}"`]);
          } else {
            await execFileAsync('cmd.exe', ['/c', 'start', '', resolved]);
          }
        } else {
          await execFileAsync('open', ['-a', resolved]);
        }
        await new Promise(r => setTimeout(r, 1500)); // Wait for app to appear
        return { content: [{ type: 'text' as const, text: `Launched: ${app} (resolved: ${resolved})` }], details: undefined };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Error launching ${app}: ${error instanceof Error ? error.message : String(error)}` }], details: undefined };
      }
    },
  };

  return [screenshotTool, clickTool, typeTool, keyPressTool, scrollTool, launchAppTool];
}
