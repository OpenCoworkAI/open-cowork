/**
 * Computer Use Adapter - Bridges Anthropic's computer_use tool to VBoxManage
 *
 * Translates high-level Computer Use actions (screenshot, click, type, etc.)
 * into VBoxManage CLI commands for a running VirtualBox VM.
 */

import * as fs from 'fs';
import * as path from 'path';
// os module available if needed for platform checks
import { app } from 'electron';
import { log, logError } from '../utils/logger';
import type { VirtualBoxBackend } from './backends/virtualbox-backend';

// ── Types ──────────────────────────────────────────────────────────

export interface ComputerUseAction {
  action:
    | 'screenshot'
    | 'click'
    | 'double_click'
    | 'triple_click'
    | 'type'
    | 'key'
    | 'scroll'
    | 'cursor_position'
    | 'wait'
    | 'drag';
  coordinate?: [number, number];
  text?: string;
  key?: string;
  delta_x?: number;
  delta_y?: number;
  duration?: number;
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
}

export interface ComputerUseResult {
  type: 'screenshot' | 'coordinate' | 'error';
  base64Image?: string;
  coordinate?: [number, number];
  error?: string;
}

// ── Scancode mapping for common keys ───────────────────────────────

const KEY_SCANCODES: Record<string, string[]> = {
  'Return': ['1c', '9c'],
  'Enter': ['1c', '9c'],
  'Tab': ['0f', '8f'],
  'space': ['39', 'b9'],
  'Escape': ['01', '81'],
  'BackSpace': ['0e', '8e'],
  'Delete': ['e0', '53', 'e0', 'd3'],
  'Up': ['e0', '48', 'e0', 'c8'],
  'Down': ['e0', '50', 'e0', 'd0'],
  'Left': ['e0', '4b', 'e0', 'cb'],
  'Right': ['e0', '4d', 'e0', 'cd'],
  'Home': ['e0', '47', 'e0', 'c7'],
  'End': ['e0', '4f', 'e0', 'cf'],
  'Page_Up': ['e0', '49', 'e0', 'c9'],
  'Page_Down': ['e0', '51', 'e0', 'd1'],
  'F1': ['3b', 'bb'],
  'F2': ['3c', 'bc'],
  'F3': ['3d', 'bd'],
  'F4': ['3e', 'be'],
  'F5': ['3f', 'bf'],
  'F6': ['40', 'c0'],
  'F7': ['41', 'c1'],
  'F8': ['42', 'c2'],
  'F9': ['43', 'c3'],
  'F10': ['44', 'c4'],
  'F11': ['57', 'd7'],
  'F12': ['58', 'd8'],
  // Modifier press/release codes (press only; release calculated by adding 0x80)
  'ctrl': ['1d'],
  'alt': ['38'],
  'shift': ['2a'],
  'super': ['e0', '5b'],
};

// ── Computer Use Adapter ──────────────────────────────────────────

export class ComputerUseAdapter {
  private vmId: string;
  private vmName: string;
  private backend: VirtualBoxBackend;
  private displayWidth = 1024;
  private displayHeight = 768;
  private screenshotDir: string;
  private lastCursorPos: [number, number] = [0, 0];

  constructor(vmId: string, vmName: string, backend: VirtualBoxBackend) {
    this.vmId = vmId;
    this.vmName = vmName;
    this.backend = backend;
    this.screenshotDir = path.join(app.getPath('userData'), 'vm-screenshots');
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  /** Get display dimensions for the computer_use tool definition */
  getDisplaySize(): { width: number; height: number } {
    return { width: this.displayWidth, height: this.displayHeight };
  }

  /** Execute a Computer Use action */
  async execute(action: ComputerUseAction): Promise<ComputerUseResult> {
    try {
      switch (action.action) {
        case 'screenshot':
          return this.takeScreenshot();
        case 'click':
          return this.click(action.coordinate!);
        case 'double_click':
          return this.doubleClick(action.coordinate!);
        case 'triple_click':
          return this.tripleClick(action.coordinate!);
        case 'type':
          return this.typeText(action.text!);
        case 'key':
          return this.sendKey(action.key!);
        case 'scroll':
          return this.scroll(
            action.coordinate || this.lastCursorPos,
            action.delta_x ?? 0,
            action.delta_y ?? 0,
          );
        case 'cursor_position':
          return this.getCursorPosition();
        case 'wait':
          return this.wait(action.duration ?? 2);
        case 'drag':
          return this.drag(action.start_coordinate!, action.end_coordinate!);
        default:
          return { type: 'error', error: `Unknown action: ${(action as any).action}` };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError('[ComputerUse] Action failed:', action.action, msg);
      return { type: 'error', error: msg };
    }
  }

  // ── Screenshot ──────────────────────────────────────────────────

  private async takeScreenshot(): Promise<ComputerUseResult> {
    const screenshotPath = path.join(this.screenshotDir, `${this.vmId}-${Date.now()}.png`);

    const result = await this.backend.screenshotVM(this.vmName, screenshotPath);
    if (!result.success) {
      return { type: 'error', error: `Screenshot failed: ${result.error}` };
    }

    try {
      const buffer = fs.readFileSync(screenshotPath);
      const base64 = buffer.toString('base64');

      // Clean up screenshot file
      try { fs.unlinkSync(screenshotPath); } catch { /* ignore */ }

      return { type: 'screenshot', base64Image: base64 };
    } catch (err) {
      return { type: 'error', error: `Failed to read screenshot: ${err}` };
    }
  }

  // ── Mouse Operations ────────────────────────────────────────────
  // Uses VBoxManage guestcontrol with xdotool as the primary approach.
  // Falls back to keyboardputstring for text input.

  private async click(coordinate: [number, number]): Promise<ComputerUseResult> {
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[ComputerUse] Click at', x, y);

    // Try xdotool via guest control (requires Guest Additions)
    try {
      await this.guestExec('xdotool', ['mousemove', '--sync', String(x), String(y), 'click', '1']);
    } catch {
      // Fallback: try keyboard scancode approach or log warning
      logError('[ComputerUse] xdotool not available, mouse click may not work without Guest Additions');
    }

    // Return a screenshot so the model can see the result
    return this.takeScreenshot();
  }

  private async doubleClick(coordinate: [number, number]): Promise<ComputerUseResult> {
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[ComputerUse] Double click at', x, y);

    try {
      await this.guestExec('xdotool', [
        'mousemove', '--sync', String(x), String(y),
        'click', '--repeat', '2', '--delay', '100', '1',
      ]);
    } catch {
      logError('[ComputerUse] xdotool not available for double click');
    }

    return this.takeScreenshot();
  }

  private async tripleClick(coordinate: [number, number]): Promise<ComputerUseResult> {
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[ComputerUse] Triple click at', x, y);

    try {
      await this.guestExec('xdotool', [
        'mousemove', '--sync', String(x), String(y),
        'click', '--repeat', '3', '--delay', '100', '1',
      ]);
    } catch {
      logError('[ComputerUse] xdotool not available for triple click');
    }

    return this.takeScreenshot();
  }

  // ── Keyboard Operations ─────────────────────────────────────────

  private async typeText(text: string): Promise<ComputerUseResult> {
    log('[ComputerUse] Type text:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));

    // Primary: use VBoxManage keyboardputstring (works without Guest Additions)
    try {
      await this.backend['vbox']('controlvm', this.vmName, 'keyboardputstring', text);
      // Small delay for the VM to process input
      await new Promise(r => setTimeout(r, 100));
    } catch {
      // Fallback: try xdotool type
      try {
        await this.guestExec('xdotool', ['type', '--clearmodifiers', text]);
      } catch {
        return { type: 'error', error: 'Failed to type text: keyboardputstring and xdotool both failed' };
      }
    }

    return this.takeScreenshot();
  }

  private async sendKey(key: string): Promise<ComputerUseResult> {
    log('[ComputerUse] Send key:', key);

    // Parse key combinations like "ctrl+c", "alt+F4", "Return"
    const parts = key.split('+').map(k => k.trim().toLowerCase());

    // Try xdotool first for key combos
    try {
      const xdotoolKey = parts.map(p => {
        // Normalize key names for xdotool
        if (p === 'ctrl' || p === 'control') return 'ctrl';
        if (p === 'cmd' || p === 'super' || p === 'meta') return 'super';
        if (p === 'enter' || p === 'return') return 'Return';
        if (p === 'backspace') return 'BackSpace';
        if (p === 'delete' || p === 'del') return 'Delete';
        if (p === 'esc' || p === 'escape') return 'Escape';
        if (p === 'tab') return 'Tab';
        if (p === 'space') return 'space';
        if (p.startsWith('f') && /^f\d+$/.test(p)) return p.toUpperCase();
        return p;
      }).join('+');

      await this.guestExec('xdotool', ['key', '--clearmodifiers', xdotoolKey]);
    } catch {
      // Fallback: use VBoxManage scancodes
      try {
        await this.sendScancodes(parts);
      } catch (err) {
        return { type: 'error', error: `Failed to send key ${key}: ${err}` };
      }
    }

    return this.takeScreenshot();
  }

  private async sendScancodes(keys: string[]): Promise<void> {
    const codes: string[] = [];
    const modifiers: string[] = [];
    let mainKey: string | null = null;

    // Separate modifiers from the main key
    for (const key of keys) {
      if (key === 'ctrl' || key === 'control') {
        modifiers.push('ctrl');
      } else if (key === 'alt') {
        modifiers.push('alt');
      } else if (key === 'shift') {
        modifiers.push('shift');
      } else if (key === 'super' || key === 'cmd' || key === 'meta') {
        modifiers.push('super');
      } else {
        mainKey = key;
      }
    }

    // Press modifiers
    for (const mod of modifiers) {
      const sc = KEY_SCANCODES[mod];
      if (sc) codes.push(...sc);
    }

    // Press and release main key
    if (mainKey) {
      const keyName = mainKey.charAt(0).toUpperCase() + mainKey.slice(1);
      const sc = KEY_SCANCODES[keyName] || KEY_SCANCODES[mainKey];
      if (sc) {
        codes.push(...sc);
      }
    }

    // Release modifiers (in reverse order)
    for (const mod of modifiers.reverse()) {
      const sc = KEY_SCANCODES[mod];
      if (sc && sc.length > 0) {
        // Release code = press code | 0x80
        const releaseCode = (parseInt(sc[sc.length - 1], 16) | 0x80).toString(16);
        if (sc.length > 1) {
          codes.push(sc[0]); // E0 prefix
        }
        codes.push(releaseCode);
      }
    }

    if (codes.length > 0) {
      await this.backend['vbox']('controlvm', this.vmName, 'keyboardputscancode', ...codes);
    }
  }

  // ── Scroll ──────────────────────────────────────────────────────

  private async scroll(
    coordinate: [number, number],
    deltaX: number,
    deltaY: number,
  ): Promise<ComputerUseResult> {
    this.lastCursorPos = coordinate;
    const [x, y] = coordinate;
    log('[ComputerUse] Scroll at', x, y, 'delta:', deltaX, deltaY);

    try {
      // Move mouse to position first
      await this.guestExec('xdotool', ['mousemove', '--sync', String(x), String(y)]);

      // Scroll: positive deltaY = scroll down, negative = scroll up
      if (deltaY !== 0) {
        const clicks = Math.abs(Math.round(deltaY / 3));
        const button = deltaY > 0 ? '5' : '4'; // 5=down, 4=up
        for (let i = 0; i < Math.max(1, clicks); i++) {
          await this.guestExec('xdotool', ['click', button]);
        }
      }

      if (deltaX !== 0) {
        const clicks = Math.abs(Math.round(deltaX / 3));
        const button = deltaX > 0 ? '7' : '6'; // 7=right, 6=left
        for (let i = 0; i < Math.max(1, clicks); i++) {
          await this.guestExec('xdotool', ['click', button]);
        }
      }
    } catch {
      logError('[ComputerUse] xdotool scroll not available');
    }

    return this.takeScreenshot();
  }

  // ── Cursor Position ─────────────────────────────────────────────

  private async getCursorPosition(): Promise<ComputerUseResult> {
    return { type: 'coordinate', coordinate: this.lastCursorPos };
  }

  // ── Wait ────────────────────────────────────────────────────────

  private async wait(durationSeconds: number): Promise<ComputerUseResult> {
    log('[ComputerUse] Waiting', durationSeconds, 'seconds');
    await new Promise(r => setTimeout(r, durationSeconds * 1000));
    return this.takeScreenshot();
  }

  // ── Drag ────────────────────────────────────────────────────────

  private async drag(
    start: [number, number],
    end: [number, number],
  ): Promise<ComputerUseResult> {
    log('[ComputerUse] Drag from', start, 'to', end);
    this.lastCursorPos = end;

    try {
      await this.guestExec('xdotool', [
        'mousemove', '--sync', String(start[0]), String(start[1]),
        'mousedown', '1',
        'mousemove', '--sync', String(end[0]), String(end[1]),
        'mouseup', '1',
      ]);
    } catch {
      logError('[ComputerUse] xdotool drag not available');
    }

    return this.takeScreenshot();
  }

  // ── Guest Execution Helper ──────────────────────────────────────

  private async guestExec(command: string, args: string[]): Promise<string> {
    // Use VBoxManage guestcontrol to execute commands inside the VM
    // This requires VirtualBox Guest Additions to be installed in the guest
    const ALLOWED_COMMANDS = ['xdotool', 'xdg-open', 'bash', 'sh', 'cat', 'ls', 'env'];
    const safeCommand = command.replace(/[/\\\.]/g, '');
    if (!ALLOWED_COMMANDS.includes(safeCommand)) {
      throw new Error(`Guest exec command not allowed: ${command}`);
    }

    // Use guest credentials from VM config, falling back to defaults
    const vmConfig = (await import('./vm-config-store')).vmConfigStore.getVM(this.vmId);
    const username = vmConfig?.guestCredentials?.username || 'user';
    const password = vmConfig?.guestCredentials?.password || 'password';

    const allArgs = [
      'guestcontrol', this.vmName, 'run',
      '--exe', `/usr/bin/${safeCommand}`,
      '--username', username,
      '--password', password,
      '--wait-stdout', '--wait-stderr',
      '--', safeCommand, ...args,
    ];

    try {
      const result = await this.backend['vbox'](...allArgs);
      return result.stdout;
    } catch (error: any) {
      // Re-throw with context
      throw new Error(`Guest exec '${command} ${args.join(' ')}' failed: ${error.message || error}`);
    }
  }
}
