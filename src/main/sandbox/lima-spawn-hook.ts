/**
 * Route bash-tool execution INTO the Lima VM (see SANDBOX-EXECUTION-AUDIT.md).
 *
 * pi's bash tool spawns `<host shell> -c <command>` with a host cwd. This
 * hook rewrites the command into `limactl shell <instance> -- bash -lc
 * 'cd <cwd> && <command>'`, so the host process is just the limactl client
 * and the actual command runs inside the VM. The cwd is the host-side
 * sandbox copy, which Lima's writable /Users mount exposes at the same path
 * inside the VM — so `cd` works in both worlds and output files land where
 * the sync-back expects them.
 *
 * Kill semantics: the tool's timeout kills the host-side limactl process
 * tree; limactl's ssh session drops and the in-VM process receives SIGHUP.
 */

export interface BashSpawnContextLike {
  command: string;
  cwd: string;
  env: Record<string, string | undefined>;
}

/** POSIX single-quote escaping: ' → '\'' inside a single-quoted string. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildLimaShellCommand(
  instanceName: string,
  cwd: string,
  command: string
): string {
  const payload = `cd ${shellSingleQuote(cwd)} && ${command}`;
  return `limactl shell ${instanceName} -- bash -lc ${shellSingleQuote(payload)}`;
}

export function buildLimaSpawnHook(
  instanceName: string
): (ctx: BashSpawnContextLike) => BashSpawnContextLike {
  return (ctx) => ({
    ...ctx,
    command: buildLimaShellCommand(instanceName, ctx.cwd, ctx.command),
  });
}
