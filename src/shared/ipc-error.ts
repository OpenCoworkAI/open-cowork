const remoteErrorPrefix = /^Error invoking remote method '[^']+': (?:Error: )?/;

/** Electron prefixes an error thrown in an ipcMain handler with the channel name. */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(remoteErrorPrefix, '');
}
