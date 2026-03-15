import { platform } from 'os'

/**
 * Returns the appropriate shell for the current platform.
 * Windows: uses PowerShell or cmd.exe
 * Unix: uses SHELL env var or falls back to /bin/bash
 */
export function getDefaultShell(): string {
  if (platform() === 'win32') {
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

/**
 * Returns shell execution arguments for running a command string.
 * Windows cmd: ['/c', command]
 * Unix bash/zsh: ['-c', command]
 */
export function getShellArgs(command: string): [string, string[]] {
  const shell = getDefaultShell()
  if (platform() === 'win32') {
    return [shell, ['/c', command]]
  }
  return [shell, ['-c', command]]
}
