import { existsSync } from 'fs';
import { homedir } from 'os';
import { join, delimiter } from 'path';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'child_process';

const CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE';
const OPEN_COWORK_ORIGINATOR = 'open_cowork';

export interface CodexCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  cliFound: boolean;
}

export interface CodexAuthStatus {
  ok: boolean;
  loggedIn: boolean;
  cliFound: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
}

export interface CodexAuthActionResult {
  ok: boolean;
  cliFound: boolean;
  message: string;
  stdout?: string;
  stderr?: string;
}

function buildCodexAuthActionMessage(
  action: 'login' | 'device-login' | 'logout',
  result: CodexCommandResult
): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (combined) {
    if (action === 'login' && /Timed out after/i.test(combined)) {
      return `${combined} Browser login runs \`codex login\`. If the localhost callback does not complete on Windows, try \`codex login --device-auth\` instead and check \`codex-login.log\` for details.`;
    }
    return combined;
  }

  if (action === 'login') {
    return 'Codex browser login finished. Manual terminal command: `codex login`. If the browser callback fails, use `codex login --device-auth` instead.';
  }
  if (action === 'device-login') {
    return 'Codex device login finished. Manual terminal command: `codex login --device-auth`.';
  }
  return 'Codex logout finished. Manual terminal command: `codex logout`.';
}

export interface SpawnCodexExecOptions {
  codexPath?: string;
  input: string;
  threadId?: string;
  model?: string;
  workingDirectory?: string;
  additionalDirectories?: string[];
  imagePaths?: string[];
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  signal?: AbortSignal;
}

function getDefaultCodexCandidates(): string[] {
  const candidates = new Set<string>();
  const appData = process.env.APPDATA?.trim();
  const home = homedir();

  if (process.platform === 'win32') {
    if (appData) {
      candidates.add(join(appData, 'npm', 'codex.cmd'));
      candidates.add(join(appData, 'npm', 'codex'));
    }
    if (home) {
      candidates.add(join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'));
      candidates.add(join(home, 'AppData', 'Roaming', 'npm', 'codex'));
    }
  }

  return Array.from(candidates);
}

function resolveCodexPath(codexPath?: string): string {
  const explicitPath = codexPath?.trim();
  if (explicitPath) {
    return explicitPath;
  }

  for (const candidate of getDefaultCodexCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return 'codex';
}

function buildCodexEnv(): NodeJS.ProcessEnv {
  const pathEntries = new Set((process.env.PATH || '').split(delimiter).filter(Boolean));
  for (const candidate of getDefaultCodexCandidates()) {
    const lastSlash = Math.max(candidate.lastIndexOf('\\'), candidate.lastIndexOf('/'));
    if (lastSlash > 0) {
      pathEntries.add(candidate.slice(0, lastSlash));
    }
  }

  return {
    ...process.env,
    PATH: Array.from(pathEntries).join(delimiter),
    [CODEX_INTERNAL_ORIGINATOR_OVERRIDE]: OPEN_COWORK_ORIGINATOR,
  };
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shouldUsePowerShellWrapper(commandPath: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath);
}

function spawnCodexChild(
  commandPath: string,
  args: string[],
  options: SpawnOptions
): ChildProcessWithoutNullStreams {
  if (shouldUsePowerShellWrapper(commandPath)) {
    const command = `& ${quoteForPowerShell(commandPath)}${args.length ? ` ${args.map(quoteForPowerShell).join(' ')}` : ''}`;
    return spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      options
    ) as ChildProcessWithoutNullStreams;
  }

  return spawn(commandPath, args, options) as ChildProcessWithoutNullStreams;
}

export function spawnCodexExecProcess(
  options: SpawnCodexExecOptions
): ChildProcessWithoutNullStreams {
  const commandPath = resolveCodexPath(options.codexPath);
  const args = ['exec', '--experimental-json'];

  if (options.model?.trim()) {
    args.push('--model', options.model.trim());
  }
  args.push('--sandbox', 'workspace-write');
  args.push('--skip-git-repo-check');
  args.push('--config', 'approval_policy="never"');
  args.push('--config', 'sandbox_workspace_write.network_access=true');

  if (options.reasoningEffort) {
    args.push('--config', `model_reasoning_effort="${options.reasoningEffort}"`);
  }
  if (options.workingDirectory?.trim()) {
    args.push('--cd', options.workingDirectory.trim());
  }
  for (const dir of options.additionalDirectories || []) {
    if (dir.trim()) {
      args.push('--add-dir', dir);
    }
  }
  if (options.threadId?.trim()) {
    args.push('resume', options.threadId.trim());
  }
  for (const imagePath of options.imagePaths || []) {
    if (imagePath.trim()) {
      args.push('--image', imagePath);
    }
  }

  const child = spawnCodexChild(commandPath, args, {
    cwd: options.workingDirectory?.trim() || process.cwd(),
    env: buildCodexEnv(),
    signal: options.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.write(options.input);
  child.stdin.end();
  return child;
}

async function runCodexCommand(
  args: string[],
  options: { codexPath?: string; cwd?: string; timeoutMs?: number } = {}
): Promise<CodexCommandResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const commandPath = resolveCodexPath(options.codexPath);

    const child = spawnCodexChild(commandPath, args, {
      cwd: options.cwd || process.cwd(),
      env: buildCodexEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: CodexCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve(result);
    };

    child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

    child.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: message,
        cliFound: !/ENOENT/i.test(message),
      });
    });

    child.once('close', (code) => {
      finish({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
        cliFound: true,
      });
    });

    const timeoutMs = options.timeoutMs ?? 15_000;
    timeoutId = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore kill errors on timeout.
      }
      finish({
        code: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8').trim(),
        stderr: `Timed out after ${timeoutMs}ms`,
        cliFound: true,
      });
    }, timeoutMs);
  });
}

export async function getCodexAuthStatus(codexPath?: string): Promise<CodexAuthStatus> {
  const result = await runCodexCommand(['login', 'status'], { codexPath, timeoutMs: 10_000 });

  if (!result.cliFound) {
    return {
      ok: false,
      loggedIn: false,
      cliFound: false,
      message: 'Codex CLI was not found. Install `@openai/codex` or set a Codex CLI path first.',
      stderr: result.stderr,
    };
  }

  if (result.code === 0) {
    return {
      ok: true,
      loggedIn: true,
      cliFound: true,
      message: result.stdout || 'Codex CLI is signed in.',
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const apiKeyHint = /api key|api-key/i.test(combined)
    ? ' If this Codex install is still in API-key mode, run `codex logout` and sign in again with ChatGPT.'
    : '';

  return {
    ok: false,
    loggedIn: false,
    cliFound: true,
    message: (combined || 'Codex CLI is not signed in.') + apiKeyHint,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runCodexAuthAction(
  action: 'login' | 'device-login' | 'logout',
  codexPath?: string
): Promise<CodexAuthActionResult> {
  const args =
    action === 'logout'
      ? ['logout']
      : action === 'device-login'
        ? ['login', '--device-auth']
        : ['login'];
  const timeoutMs = action === 'logout' ? 30_000 : 5 * 60_000;
  const result = await runCodexCommand(args, { codexPath, timeoutMs });

  if (!result.cliFound) {
    return {
      ok: false,
      cliFound: false,
      message: 'Codex CLI was not found. Install `@openai/codex` or set a Codex CLI path first.',
      stderr: result.stderr,
    };
  }

  return {
    ok: result.code === 0,
    cliFound: true,
    message: buildCodexAuthActionMessage(action, result),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
