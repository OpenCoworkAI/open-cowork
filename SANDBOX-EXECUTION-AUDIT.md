# Sandbox Execution-Path Audit

> Status: **static analysis, high confidence** — runtime probe pending (requires a machine with a provisioned Lima instance). Written 2026-07 during the goal-oriented review.

## Question

When the VM sandbox is enabled, do the agent's bash/file tools actually execute **inside** the WSL/Lima VM?

## Verdict

**No.** The VM is used as a file-sync target only. Command execution happens on the host in every configuration, and on macOS with Lima enabled the coding tools' working directory points at a VM-internal path that does not exist on the host — meaning bash commands likely fail outright when the sandbox is on.

## Evidence chain

1. **The bash tool is host spawn.** Coding tools come from pi-coding-agent's `createBashTool`, which runs `spawn(shell, [...args, command], { cwd })` in the Electron main process (`node_modules/@mariozechner/pi-coding-agent/dist/core/tools/bash.js:36`). There is no VM wrapping.
2. **No limactl/wsl wrapping of execution anywhere.** Every `limactl` invocation in `agent-runner.ts` (lines ~1460–1545) is `mkdir`/`rsync`/`ls` — file synchronization. `windows-bash-operations.ts` spawns host `cmd`/`powershell` and never calls `wsl -d`.
3. **bashOptions only overrides on Windows** (`agent-runner.ts:2170-2171`), and that override is still host execution.
4. **With Lima enabled, cwd is a VM-internal path.** `lima-sync.ts:119-122` computes `sandboxPath` from `limaExec('cd ~ && pwd')` — the VM user's home (e.g. `/home/<user>.linux/.claude/sandbox/<id>`). `agent-runner.ts:1728-1729` sets `effectiveCwd = sandboxPath` and hands it to `createCodingTools`. The host then spawns a shell with a cwd that only exists inside the VM → ENOENT.
5. The instance is created with `limactl create --mount-writable template:ubuntu` (`lima-bridge.ts:310`); comments assert "Lima mounts /Users directly" — true for workspace paths, but the VM home is not a host path.

## Implications

- "All commands execute in an isolated VM" (previous README wording) was not true in any mode. README has been corrected to "opt-in, shell/file operations, GUI + sudo on host".
- The Windows "sandbox" currently amounts to *working on a synced copy* — real isolation of writes to the workspace copy, but arbitrary host command execution is unaffected.
- The macOS Lima path appears **functionally broken** for command execution when enabled (deterministic path mismatch). Low user impact so far because the sandbox defaults to off.

## Recommended fix (concrete)

pi's bash tool accepts a **`spawnHook`** (`bash.js:102 resolveSpawnContext`) that can rewrite `{command, cwd, env}` before spawn. Route execution into the VM without forking the SDK:

```ts
const bashOptions = useSandboxIsolation && mode === 'lima'
  ? {
      spawnHook: (ctx) => ({
        ...ctx,
        command: undefined, // use rewritten form below
        // limactl shell runs inside the VM; cwd is the VM-internal sandboxPath
        ...wrapForLima(ctx, sandboxPath), // → limactl shell claude-sandbox -- sh -c 'cd <cwd> && <command>'
      }),
    }
  : undefined;
```

Same shape for WSL via `wsl -d <distro> -- sh -c ...`. Requirements before shipping:

1. Verify on a machine with a provisioned Lima instance (create VM, enable sandbox, run `touch /tmp/probe && uname -a` through the agent, confirm the file exists in the VM and `uname` reports Linux).
2. Timeout/kill semantics: `killProcessTree` must terminate the `limactl shell` child and the in-VM process.
3. Path translation for tool output (`sanitizeOutputPaths`) must map VM paths back to host workspace paths.
4. An integration test asserting the execution environment (e.g. `uname`), so this can never silently regress.

## Interim mitigations already shipped

- README wording corrected (opt-in; GUI/sudo on host by design).
- Persistent isolation-status badge in the UI (`SandboxStatusBadge`), so the actual mode is always visible.
