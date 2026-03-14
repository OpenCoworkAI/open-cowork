import { isUncPath } from '../shared/local-file-path';

type WorkspacePathConstraintInput = {
  platform: NodeJS.Platform;
  sandboxEnabled: boolean;
  workspacePath?: string;
};

export function getUnsupportedWorkspacePathReason({
  platform,
  sandboxEnabled,
  workspacePath,
}: WorkspacePathConstraintInput): string | null {
  if (!workspacePath) {
    return null;
  }

  if (platform === 'win32' && sandboxEnabled && isUncPath(workspacePath)) {
    return 'Windows network share folders are not supported while sandbox mode is enabled. Choose a local drive folder or turn sandbox mode off.';
  }

  return null;
}
