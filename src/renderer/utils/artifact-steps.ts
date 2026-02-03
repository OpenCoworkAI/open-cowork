import type { TraceStep } from '../types';

const FILE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'Write',
  'Edit',
  'NotebookEdit',
  'notebook_edit',
]);

type ArtifactStepResult = {
  artifactSteps: TraceStep[];
  fileSteps: TraceStep[];
  displayArtifactSteps: TraceStep[];
};

export function getArtifactLabel(pathValue: string, name?: string): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return trimmedName;
  }

  const trimmedPath = pathValue.trim();
  if (!trimmedPath) {
    return '';
  }

  const normalized = trimmedPath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || trimmedPath;
}

export function getArtifactSteps(steps: TraceStep[]): ArtifactStepResult {
  const artifactSteps = steps.filter(
    (step) => step.type === 'tool_result' && step.toolName === 'artifact'
  );

  const fileSteps = steps.filter((step) => {
    if (step.status !== 'completed') {
      return false;
    }
    if (!step.toolName || !FILE_TOOL_NAMES.has(step.toolName)) {
      return false;
    }
    return step.type === 'tool_result' || step.type === 'tool_call';
  });

  return {
    artifactSteps,
    fileSteps,
    displayArtifactSteps: artifactSteps.length > 0 ? artifactSteps : fileSteps,
  };
}
