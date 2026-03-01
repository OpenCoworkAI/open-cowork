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
  const trimmedPath = pathValue.trim();
  if (trimmedPath) {
    const normalized = trimmedPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || trimmedPath;
  }

  return trimmedName ?? '';
}

export type ArtifactIconKey =
  | 'slides'
  | 'table'
  | 'doc'
  | 'code'
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'file';

export type ArtifactIconComponent =
  | 'presentation'
  | 'table'
  | 'document'
  | 'code'
  | 'image'
  | 'text'
  | 'audio'
  | 'video'
  | 'archive'
  | 'file';

const extensionIconMap: Record<string, ArtifactIconKey> = {
  pptx: 'slides',
  ppt: 'slides',
  key: 'slides',
  keynote: 'slides',
  xlsx: 'table',
  xls: 'table',
  csv: 'table',
  tsv: 'table',
  docx: 'doc',
  doc: 'doc',
  pdf: 'doc',
  md: 'code',
  markdown: 'code',
  js: 'code',
  jsx: 'code',
  ts: 'code',
  tsx: 'code',
  py: 'code',
  java: 'code',
  go: 'code',
  rs: 'code',
  c: 'code',
  cpp: 'code',
  h: 'code',
  hpp: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  json: 'code',
  lock: 'code',
  yaml: 'code',
  yml: 'code',
  txt: 'text',
  log: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
};

export function getArtifactIconKey(filename: string): ArtifactIconKey {
  const normalized = filename.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf('.');
  if (lastDot === -1 || lastDot === normalized.length - 1) {
    return 'file';
  }

  const ext = normalized.slice(lastDot + 1);
  return extensionIconMap[ext] ?? 'file';
}

export function getArtifactIconComponent(filename: string): ArtifactIconComponent {
  const key = getArtifactIconKey(filename);
  switch (key) {
    case 'slides':
      return 'presentation';
    case 'table':
      return 'table';
    case 'doc':
      return 'document';
    case 'code':
      return 'code';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'archive':
      return 'archive';
    case 'text':
      return 'text';
    default:
      return 'file';
  }
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
