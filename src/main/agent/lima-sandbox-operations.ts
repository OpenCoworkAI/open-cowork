import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { access, readFile } from 'fs/promises';
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from '@mariozechner/pi-coding-agent';

/** Display path the model sees. The guest directory is the Lima sandbox path. */
export const VIRTUAL_WORKSPACE_PATH = '/workspace';

export const LIMA_SANDBOX_INSTANCE = 'claude-sandbox';

const VIRTUAL_WORKSPACE_PATTERN = /(^|[\s'"`=;|&()<>])\/workspace(?=\/|$|[\s'"`;|&()<>])/g;
const GUEST_FILE_MISSING_EXIT_CODE = 44;

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface LimaSandboxOperationsOptions {
  spawnProcess?: SpawnProcess;
  instanceName?: string;
}

interface GuestRunOptions {
  stdin?: Buffer;
  timeoutSeconds?: number;
  onData?: (chunk: Buffer) => void;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

function defaultSpawn(command: string, args: string[], options: SpawnOptions): ChildProcess {
  return spawn(command, args, options);
}

function assertInstanceName(instanceName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(instanceName)) {
    throw new Error(`Invalid Lima instance name: ${instanceName}`);
  }
  return instanceName;
}

function assertSandboxPath(sandboxPath: string): string {
  if (!sandboxPath.startsWith('/')) {
    throw new Error(`Lima sandbox path must be absolute: ${sandboxPath}`);
  }
  return sandboxPath;
}

/** POSIX single-quote escaping. The result does not include the surrounding quotes. */
export function shellEscapePath(pathValue: string): string {
  return pathValue.replace(/'/g, `'\\''`);
}

/**
 * Map the virtual `/workspace` root onto the guest sandbox directory.
 * Paths that would leave that directory are rejected. Other absolute guest
 * paths are left unchanged so a command can still name the real sandbox path.
 */
export function mapVirtualWorkspacePath(pathValue: string, sandboxPath: string): string {
  const root = assertSandboxPath(sandboxPath).replace(/\/+$/, '');
  if (pathValue !== VIRTUAL_WORKSPACE_PATH && !pathValue.startsWith(`${VIRTUAL_WORKSPACE_PATH}/`)) {
    return pathValue;
  }

  const relative = pathValue.slice(VIRTUAL_WORKSPACE_PATH.length).replace(/^\/+/, '');
  const segments = relative.split('/').filter((segment) => segment.length > 0);
  const resolved = [root];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 1) {
        throw new Error(`Path escapes sandbox workspace: ${pathValue}`);
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

/** Rewrite `/workspace` tokens inside a guest command without touching lookalike paths. */
export function rewriteVirtualWorkspaceCommand(command: string, sandboxPath: string): string {
  const root = assertSandboxPath(sandboxPath);
  return command.replace(VIRTUAL_WORKSPACE_PATTERN, (_match, prefix: string) => `${prefix}${root}`);
}

export function buildLimaGuestShellScript(
  cwd: string,
  command: string,
  sandboxPath: string
): string {
  const guestCwd = mapVirtualWorkspacePath(cwd, sandboxPath);
  const guestCommand = rewriteVirtualWorkspaceCommand(command, sandboxPath);
  const escapedCwd = shellEscapePath(guestCwd);
  return [
    `mkdir -p -- '${escapedCwd}' && cd -- '${escapedCwd}'`,
    `|| { echo 'Working directory does not exist: ${escapedCwd}' >&2;`,
    `echo 'Cannot execute bash commands.' >&2; exit 1; };`,
    guestCommand,
  ].join(' ');
}

function asBuffer(data: Buffer | string): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function runGuestScript(
  spawnProcess: SpawnProcess,
  instanceName: string,
  script: string,
  options: GuestRunOptions = {}
): Promise<{ exitCode: number | null; stdout: Buffer; stderr: Buffer }> {
  const validatedInstance = assertInstanceName(instanceName);
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }

    let child: ChildProcess;
    try {
      child = spawnProcess('limactl', ['shell', validatedInstance, '--', 'bash', '-c', script], {
        env: { ...process.env, ...options.env },
        stdio: [options.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    let stdinError: NodeJS.ErrnoException | undefined;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finishResolve = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const takeChunk = (target: Buffer[], data: Buffer | string) => {
      const chunk = asBuffer(data);
      if (options.onData) {
        options.onData(chunk);
      } else {
        target.push(chunk);
      }
    };

    child.stdout?.on('data', (data: Buffer | string) => takeChunk(stdoutChunks, data));
    child.stderr?.on('data', (data: Buffer | string) => takeChunk(stderrChunks, data));
    child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') {
        stdinError = error;
      } else {
        finishReject(error);
      }
    });
    child.once('error', (error: Error) => finishReject(error));
    child.once('close', (code: number | null) => {
      if (options.signal?.aborted) {
        finishReject(new Error('aborted'));
        return;
      }
      if (timedOut) {
        finishReject(new Error(`timeout:${options.timeoutSeconds}`));
        return;
      }
      if (stdinError && (code === 0 || stderrChunks.length === 0)) {
        finishReject(stdinError);
        return;
      }
      finishResolve(code);
    });

    const killChild = () => {
      child.kill('SIGKILL');
    };

    function onAbort() {
      killChild();
    }

    if (options.timeoutSeconds !== undefined && options.timeoutSeconds > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killChild();
      }, options.timeoutSeconds * 1000);
      timeoutHandle.unref?.();
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });

    if (options.stdin && child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
}

async function runGuestOrThrow(
  spawnProcess: SpawnProcess,
  instanceName: string,
  script: string,
  stdin?: Buffer,
  missingPath?: string
): Promise<Buffer> {
  const result = await runGuestScript(spawnProcess, instanceName, script, { stdin });
  if (result.exitCode === GUEST_FILE_MISSING_EXIT_CODE && missingPath !== undefined) {
    throw Object.assign(new Error(`ENOENT: no such file or directory, '${missingPath}'`), {
      code: 'ENOENT',
      path: missingPath,
    });
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.toString().trim() || result.stdout.toString().trim();
    throw new Error(detail || `Lima command failed with code ${result.exitCode}`);
  }
  return result.stdout;
}

export function createLimaSandboxBashOperations(
  sandboxPath: string,
  options: LimaSandboxOperationsOptions = {}
): BashOperations {
  const root = assertSandboxPath(sandboxPath);
  const instanceName = options.instanceName ?? LIMA_SANDBOX_INSTANCE;
  const spawnProcess = options.spawnProcess ?? defaultSpawn;

  return {
    exec: (command, cwd, { onData, signal, timeout, env }) =>
      runGuestScript(spawnProcess, instanceName, buildLimaGuestShellScript(cwd, command, root), {
        onData,
        signal,
        timeoutSeconds: timeout,
        env,
      }).then(({ exitCode }) => ({ exitCode })),
  };
}

export function createLimaSandboxFileOperations(
  sandboxPath: string,
  options: LimaSandboxOperationsOptions = {}
): { read: ReadOperations; write: WriteOperations; edit: EditOperations } {
  const root = assertSandboxPath(sandboxPath);
  const instanceName = options.instanceName ?? LIMA_SANDBOX_INSTANCE;
  const spawnProcess = options.spawnProcess ?? defaultSpawn;

  const guestPath = (pathValue: string) =>
    shellEscapePath(mapVirtualWorkspacePath(pathValue, root));

  const read: ReadOperations = {
    access: (absolutePath) =>
      runGuestOrThrow(
        spawnProcess,
        instanceName,
        `test -e '${guestPath(absolutePath)}' || exit ${GUEST_FILE_MISSING_EXIT_CODE}`,
        undefined,
        absolutePath
      ).then(() => undefined),
    readFile: (absolutePath) =>
      runGuestOrThrow(spawnProcess, instanceName, `cat -- '${guestPath(absolutePath)}'`),
  };

  const write: WriteOperations = {
    mkdir: (dir) =>
      runGuestOrThrow(spawnProcess, instanceName, `mkdir -p -- '${guestPath(dir)}'`).then(
        () => undefined
      ),
    writeFile: (absolutePath, content) =>
      runGuestOrThrow(
        spawnProcess,
        instanceName,
        `cat > '${guestPath(absolutePath)}'`,
        Buffer.from(content)
      ).then(() => undefined),
  };

  const edit: EditOperations = {
    access: (absolutePath) =>
      runGuestOrThrow(
        spawnProcess,
        instanceName,
        `test -e '${guestPath(absolutePath)}' || exit ${GUEST_FILE_MISSING_EXIT_CODE}; ` +
          `test -r '${guestPath(absolutePath)}' && test -w '${guestPath(absolutePath)}'`,
        undefined,
        absolutePath
      ).then(() => undefined),
    readFile: read.readFile,
    writeFile: write.writeFile,
  };

  return { read, write, edit };
}

/**
 * Coding tools whose bash, read, write, and edit calls run inside Lima.
 * The pi SDK checks the working directory on the host before local bash, and
 * the Lima sandbox path is not a host path, so these tools must not use that backend.
 */
export function createLimaSandboxCodingTools(
  sandboxPath: string,
  options: LimaSandboxOperationsOptions = {}
): [
  ReturnType<typeof createReadTool>,
  ReturnType<typeof createBashTool>,
  ReturnType<typeof createEditTool>,
  ReturnType<typeof createWriteTool>,
] {
  const files = createLimaSandboxFileOperations(sandboxPath, options);
  const hostOutputPaths = new Set<string>();
  const bash = createBashTool(sandboxPath, {
    operations: createLimaSandboxBashOperations(sandboxPath, options),
  });

  return [
    createReadTool(sandboxPath, {
      // Only output paths emitted by this SDK tool can be read on the host.
      operations: {
        access: (absolutePath) =>
          hostOutputPaths.has(absolutePath)
            ? access(absolutePath)
            : files.read.access(absolutePath),
        readFile: (absolutePath) =>
          hostOutputPaths.has(absolutePath)
            ? readFile(absolutePath)
            : files.read.readFile(absolutePath),
      },
    }),
    {
      ...bash,
      execute: async (...args: Parameters<typeof bash.execute>) => {
        const [toolCallId, params, signal, onUpdate] = args;
        const result = await bash.execute(toolCallId, params, signal, (update) => {
          if (update.details?.fullOutputPath) hostOutputPaths.add(update.details.fullOutputPath);
          onUpdate?.(update);
        });
        if (result.details?.fullOutputPath) hostOutputPaths.add(result.details.fullOutputPath);
        return result;
      },
    },
    createEditTool(sandboxPath, { operations: files.edit }),
    createWriteTool(sandboxPath, { operations: files.write }),
  ];
}
