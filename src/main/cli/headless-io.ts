/**
 * @module main/cli/headless-io
 *
 * Headless (CLI) I/O adapter for running the agent without an Electron GUI.
 *
 * Responsibilities:
 * - Converts ServerEvents to JSONL output on stdout
 * - Reads stdin for single-shot prompts or RPC ClientEvent JSONL
 * - Provides a permission handler that auto-approves or auto-denies
 * - Redirects console.log/warn to stderr so stdout stays clean JSONL
 *
 * Dependencies: none (pure Node stdio)
 */

import * as readline from 'readline';
import type { ServerEvent, ClientEvent } from '../../renderer/types';

// ── Headless JSONL event types ──

export interface HeadlessEvent {
  type: string;
  [key: string]: unknown;
}

// ── stdout JSONL writer ──

/**
 * Write a single JSONL event to stdout.
 * All headless output goes through this function to keep the format consistent.
 */
function writeJsonl(event: HeadlessEvent): void {
  const line = JSON.stringify(event);
  process.stdout.write(line + '\n');
}

/**
 * Create a sendToRenderer replacement that writes ServerEvents as JSONL to stdout.
 *
 * Maps internal ServerEvent types to a simplified JSONL schema:
 *   stream.message   -> { type: "stream.message", sessionId, role, content }
 *   stream.partial   -> { type: "stream.partial", sessionId, text }
 *   stream.thinking  -> { type: "stream.thinking", sessionId, text }
 *   session.status   -> { type: "session.status", sessionId, status, error? }
 *   trace.step       -> { type: "trace.step", sessionId, title, status, toolName? }
 *   permission.*     -> { type: "permission.request"|"permission.dismiss", ... }
 *   error            -> { type: "error", message, code? }
 *   *                -> forwarded as-is (passthrough)
 */
export function createHeadlessSendToRenderer(): (event: ServerEvent) => void {
  return (event: ServerEvent) => {
    switch (event.type) {
      case 'stream.message': {
        const msg = event.payload.message;
        writeJsonl({
          type: 'stream.message',
          sessionId: event.payload.sessionId,
          role: msg.role,
          content: msg.content,
        });
        break;
      }

      case 'stream.partial':
        writeJsonl({
          type: 'stream.partial',
          sessionId: event.payload.sessionId,
          text: event.payload.delta,
        });
        break;

      case 'stream.thinking':
        writeJsonl({
          type: 'stream.thinking',
          sessionId: event.payload.sessionId,
          text: event.payload.delta,
        });
        break;

      case 'session.status':
        writeJsonl({
          type: 'session.status',
          sessionId: event.payload.sessionId,
          status: event.payload.status,
          ...(event.payload.error ? { error: event.payload.error } : {}),
        });
        break;

      case 'trace.step': {
        const step = event.payload.step;
        writeJsonl({
          type: 'trace.step',
          sessionId: event.payload.sessionId,
          stepId: step.id,
          title: step.title,
          status: step.status,
          ...(step.toolName ? { toolName: step.toolName } : {}),
        });
        break;
      }

      case 'trace.update':
        writeJsonl({
          type: 'trace.update',
          sessionId: event.payload.sessionId,
          stepId: event.payload.stepId,
          updates: event.payload.updates,
        });
        break;

      case 'permission.request':
        writeJsonl({
          type: 'permission.request',
          toolUseId: event.payload.toolUseId,
          toolName: event.payload.toolName,
          input: event.payload.input,
        });
        break;

      case 'permission.dismiss':
        writeJsonl({
          type: 'permission.dismiss',
          toolUseId: event.payload.toolUseId,
        });
        break;

      case 'error':
        writeJsonl({
          type: 'error',
          message: event.payload.message,
          ...(event.payload.code ? { code: event.payload.code } : {}),
        });
        break;

      default:
        // Forward other events as-is for extensibility
        writeJsonl({
          type: event.type,
          ...('payload' in event ? { payload: (event as { payload: unknown }).payload } : {}),
        });
        break;
    }
  };
}

// ── Emit lifecycle events ──

export function emitSessionStarted(sessionId: string): void {
  writeJsonl({ type: 'session.started', sessionId });
}

export function emitSessionEnded(sessionId: string): void {
  writeJsonl({ type: 'session.ended', sessionId });
}

export function emitHeadlessReady(): void {
  writeJsonl({ type: 'headless.ready', mode: 'rpc' });
}

// ── stdin readers ──

/**
 * Read a single prompt from stdin (piped mode).
 * Resolves with the full stdin content once the stream closes.
 */
export function readStdinPrompt(): Promise<string> {
  return new Promise((resolve, reject) => {
    // If stdin is a TTY and no data is piped, return empty immediately
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('').trim()));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

/**
 * Start a JSONL RPC loop reading ClientEvent objects from stdin.
 * Each line should be a JSON-encoded ClientEvent.
 * Calls handleClientEvent for each parsed event.
 * Returns a cleanup function to close the readline interface.
 */
export function startRpcLoop(
  handleClientEvent: (event: ClientEvent) => Promise<unknown>
): () => void {
  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const event = JSON.parse(trimmed) as ClientEvent;
      try {
        const result = await handleClientEvent(event);
        // Write result back for invoke-style calls
        if (result !== undefined && result !== null) {
          writeJsonl({ type: 'rpc.result', eventType: event.type, result });
        }
      } catch (err) {
        writeJsonl({
          type: 'rpc.error',
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } catch {
      // Invalid JSON line — log to stderr, skip
      process.stderr.write(`[Headless] Invalid JSON on stdin: ${trimmed.slice(0, 200)}\n`);
    }
  });

  rl.on('close', () => {
    // stdin closed — in RPC mode this means the controller disconnected
    process.stderr.write('[Headless] stdin closed, shutting down\n');
    process.exit(0);
  });

  return () => rl.close();
}

// ── Console redirection ──

/**
 * Redirect console.log and console.warn to stderr so that stdout
 * is reserved exclusively for JSONL events.
 *
 * console.error already writes to stderr by default.
 *
 * Call this as early as possible in the headless startup path.
 */
export function redirectConsoleToStderr(): void {
  const stderrWrite = (...args: unknown[]) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    process.stderr.write(msg + '\n');
  };

  console.log = stderrWrite;
  console.warn = stderrWrite;
  console.info = stderrWrite;
  console.debug = stderrWrite;
  // console.error already goes to stderr — leave it alone
}

// ── CLI argument parsing ──

export interface HeadlessArgs {
  headless: boolean;
  prompt: string | null;
  cwd: string;
  autoApprove: boolean;
  mode: 'json' | 'rpc' | 'stdio';
}

/**
 * Parse headless-related CLI arguments from process.argv.
 * No external dependencies — just process.argv scanning.
 */
export function parseHeadlessArgs(): HeadlessArgs {
  const argv = process.argv;

  const headless = argv.includes('--headless');

  // Parse --prompt / -p
  let prompt: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '-p' || argv[i] === '--prompt') && i + 1 < argv.length) {
      prompt = argv[i + 1];
      break;
    }
  }

  // Parse --cwd
  let cwd = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cwd' && i + 1 < argv.length) {
      cwd = argv[i + 1];
      break;
    }
  }

  // Parse --auto-approve
  const autoApprove = argv.includes('--auto-approve');

  // Parse --mode
  let mode: 'json' | 'rpc' | 'stdio' = prompt ? 'json' : 'rpc';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--mode' && i + 1 < argv.length) {
      const val = argv[i + 1];
      if (val === 'json' || val === 'rpc' || val === 'stdio') {
        mode = val;
      }
      break;
    }
  }

  return { headless, prompt, cwd, autoApprove, mode };
}
