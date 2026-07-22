/**
 * True-isolation routing for Windows/WSL (counterpart of lima-spawn-hook).
 *
 * On Windows the sandbox copy lives INSIDE the WSL distro
 * (`/home/<user>/.claude/sandbox/<id>`, see sandbox-sync.ts). Routing:
 *  - bash commands run inside WSL via `wsl.exe -d <distro> -- bash -lc …`,
 *    built as an argv array so no host-shell string quoting is involved;
 *  - host-side file tools (read/write/edit) reach the same directory through
 *    the `\\wsl$\<distro>` UNC bridge, so the coding tools' cwd is the UNC
 *    form and this module translates it back to the Linux path for bash.
 *
 * Kill semantics: the tool's timeout taskkills the host wsl.exe client; the
 * in-distro process may briefly outlive it (WSL limitation) — same caveat as
 * the Lima path, documented in SANDBOX-EXECUTION-AUDIT.md.
 */
import { shellSingleQuote } from './lima-spawn-hook';

const UNC_PREFIXES = ['\\\\wsl$\\', '\\\\wsl.localhost\\'];

/** Linux path inside a distro → host-visible UNC path. */
export function toWslUncPath(distro: string, linuxPath: string): string {
  return `\\\\wsl$\\${distro}${linuxPath.replace(/\//g, '\\')}`;
}

/**
 * Host UNC path → Linux path inside the distro. Non-UNC input (already a
 * Linux path) passes through unchanged.
 */
export function fromWslUncPath(distro: string, p: string): string {
  for (const prefix of UNC_PREFIXES) {
    if (p.toLowerCase().startsWith((prefix + distro + '\\').toLowerCase())) {
      const rest = p.slice(prefix.length + distro.length);
      return rest.replace(/\\/g, '/') || '/';
    }
  }
  return p;
}

export interface WslBashInvocation {
  shell: string;
  args: string[];
}

export function buildWslBashInvocation(
  distro: string,
  cwd: string,
  command: string
): WslBashInvocation {
  const linuxCwd = fromWslUncPath(distro, cwd);
  const payload = `cd ${shellSingleQuote(linuxCwd)} && ${command}`;
  // argv-based: wsl.exe forwards the payload as a single bash argument, so
  // only bash's own single-quote escaping is in play — no cmd.exe quoting.
  return { shell: 'wsl.exe', args: ['-d', distro, '--', 'bash', '-lc', payload] };
}
