import { resolvePathAgainstWorkspace } from '../../shared/workspace-path';

export function resolveArtifactPath(pathValue: string, cwd?: string | null): string {
  return resolvePathAgainstWorkspace(pathValue, cwd);
}
