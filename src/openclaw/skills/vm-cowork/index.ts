/**
 * Navi VM Cowork Skill
 *
 * Intelligently suggests launching a VirtualBox desktop when the user's task
 * requires a GUI environment. Manages VM lifecycle and enables Computer Use
 * for hands-on collaboration inside the VM.
 */

import type { AgentCapability, OpenClawSession } from '../../types';

const VM_COWORK_INTENTS = [
  'launch-desktop',
  'stop-desktop',
  'vm-status',
  'provision-vm',
  'vm-help',
  'cowork-suggest',
  'gui-task',
  'browser-test',
  'desktop-app',
];

/** Keywords that indicate a GUI desktop environment might be needed */
const GUI_KEYWORDS = [
  'browser', 'firefox', 'chrome', 'chromium', 'web browser',
  'desktop', 'gui', 'graphical',
  'gimp', 'inkscape', 'libreoffice', 'libre office',
  'screenshot', 'screen capture',
  'visual test', 'ui test', 'e2e test', 'end-to-end',
  'selenium', 'playwright',
  'linux app', 'linux application',
  'design tool', 'wireframe', 'mockup',
  'file manager', 'nautilus', 'thunar',
  'terminal emulator',
  'display', 'window manager',
  'open the app', 'launch the app',
  'walk me through', 'show me how',
  'visual demo', 'demonstration',
];

export class VMCoworkSkill implements AgentCapability {
  skillId = 'navi-vm-cowork';
  name = 'VM Cowork Desktop';
  intents = VM_COWORK_INTENTS;

  handles(intent: string): boolean {
    return this.intents.includes(intent);
  }

  /**
   * Check if a user message likely needs a GUI desktop environment.
   * Used by the agent pipeline to decide whether to emit a vm-suggestion card.
   */
  static messageNeedsDesktop(message: string): boolean {
    const lower = message.toLowerCase();
    return GUI_KEYWORDS.some(kw => lower.includes(kw));
  }

  async execute(message: string, session: OpenClawSession): Promise<string> {
    // The actual VM lifecycle is handled via IPC in the main process.
    // This skill's primary role is intent classification and card emission.
    // The ClaudeAgentRunner reads the SKILL.md and uses it for prompt context.
    return '';
  }
}

export default VMCoworkSkill;
