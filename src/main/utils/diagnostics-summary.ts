import { homedir } from 'os';
import path from 'path';
import type { Message, Session, TraceStep } from '../../renderer/types';

const MAX_DIAGNOSTIC_SESSIONS = 8;
const MAX_DIAGNOSTIC_ERROR_STEPS = 20;

export interface DiagnosticLogFile {
  name: string;
  path: string;
  size: number;
  mtime: Date;
}

export interface DiagnosticsSummarySessionItem {
  id: string;
  status: Session['status'];
  cwd: string | null;
  model: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  traceStepCount: number;
  errorStepCount: number;
  lastUserMessageMeta: MessageMetaSummary | null;
  lastAssistantMessageMeta: MessageMetaSummary | null;
  latestErrorStep: TraceStepMetaSummary | null;
}

export interface MessageMetaSummary {
  timestamp: string | null;
  blockTypes: string[];
  textBlockCount: number;
  imageBlockCount: number;
  fileAttachmentCount: number;
  toolUseCount: number;
  toolResultCount: number;
}

export interface TraceStepMetaSummary {
  id: string;
  type: TraceStep['type'];
  status: TraceStep['status'];
  toolName: string | null;
  timestamp: string | null;
  durationMs: number | null;
  contentLength: number;
  toolOutputLength: number;
  toolInputKeys: string[];
  isError: boolean;
}

export interface DiagnosticsSummary {
  exportedAt: string;
  app: {
    version: string;
    isPackaged: boolean;
    platform: string;
    arch: string;
    nodeVersion: string;
    electronVersion?: string;
    chromeVersion?: string;
  };
  runtime: {
    currentWorkingDir: string | null;
    logsDirectory: string;
    logFileCount: number;
    totalLogSizeBytes: number;
    devLogsEnabled: boolean;
  };
  config: {
    provider: string;
    model: string;
    baseUrl: string | null;
    customProtocol: string | null;
    sandboxEnabled: boolean;
    thinkingEnabled: boolean;
    apiKeyConfigured: boolean;
    claudeCodePathConfigured: boolean;
    defaultWorkdir: string | null;
    globalSkillsPathConfigured: boolean;
  };
  sandbox: {
    mode: string;
    initialized: boolean;
  };
  sessions: {
    total: number;
    included: number;
    items: DiagnosticsSummarySessionItem[];
  };
  recentErrorSteps: Array<
    TraceStepMetaSummary & {
      sessionId: string;
    }
  >;
  logFiles: Array<{
    name: string;
    size: number;
    modifiedAt: string | null;
  }>;
}

export interface DiagnosticsSummaryDependencies {
  getMessages(sessionId: string): Message[];
  getTraceSteps(sessionId: string): TraceStep[];
}

export interface BuildDiagnosticsSummaryInput {
  exportedAt?: Date;
  app: DiagnosticsSummary['app'];
  runtime: DiagnosticsSummary['runtime'];
  config: DiagnosticsSummary['config'];
  sandbox: DiagnosticsSummary['sandbox'];
  sessions: Session[];
  logFiles: DiagnosticLogFile[];
  deps: DiagnosticsSummaryDependencies;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function getPathTail(value: string, maxSegments = 2): string {
  const normalized = normalizePathSeparators(value).replace(/\/+$/, '');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return '';
  }
  return segments.slice(-maxSegments).join('/');
}

function getRelativeTail(value: string, basePath: string, maxSegments = 2): string {
  const normalizedValue = normalizePathSeparators(value).replace(/\/+$/, '');
  const normalizedBase = normalizePathSeparators(basePath).replace(/\/+$/, '');
  if (!normalizedBase || !normalizedValue.startsWith(normalizedBase)) {
    return getPathTail(normalizedValue, maxSegments);
  }

  const suffix = normalizedValue.slice(normalizedBase.length).replace(/^\/+/, '');
  if (!suffix) {
    return '';
  }
  return getPathTail(suffix, maxSegments);
}

export function redactFileSystemPath(value?: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = normalizePathSeparators(trimmed);
  const normalizedHome = normalizePathSeparators(homedir());

  if (normalizedHome && normalized.startsWith(normalizedHome)) {
    const tail = getRelativeTail(normalized, normalizedHome);
    return tail ? `<home>/${tail}` : '<home>';
  }

  const winTempDirs = [process.env.TEMP, process.env.TMP]
    .filter(Boolean)
    .map((d) => normalizePathSeparators(path.normalize(d!)));
  const normalizedForTmpCheck = normalizePathSeparators(path.normalize(trimmed));

  for (const winTmp of winTempDirs) {
    if (normalizedForTmpCheck.startsWith(winTmp)) {
      const tail = getRelativeTail(normalizedForTmpCheck, winTmp);
      return tail ? `<tmp>/${tail}` : '<tmp>';
    }
  }

  if (/AppData[/\\]Local[/\\]Temp/i.test(trimmed)) {
    const appDataTempIdx = normalizedForTmpCheck.search(/appdata\/local\/temp/i);
    if (appDataTempIdx >= 0) {
      const tmpBase = normalizedForTmpCheck.slice(
        0,
        appDataTempIdx + 'AppData/Local/Temp'.length
      );
      const tail = getRelativeTail(normalizedForTmpCheck, tmpBase);
      return tail ? `<tmp>/${tail}` : '<tmp>';
    }
  }

  if (
    normalized.startsWith('/tmp') ||
    normalized.startsWith('/private/tmp') ||
    normalized.startsWith('/var/folders/')
  ) {
    const tmpBase = normalized.startsWith('/private/tmp')
      ? '/private/tmp'
      : normalized.startsWith('/var/folders/')
        ? '/var/folders'
        : '/tmp';
    const tail = getRelativeTail(normalized, tmpBase);
    return tail ? `<tmp>/${tail}` : '<tmp>';
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//') || path.isAbsolute(trimmed)) {
    const tail = getPathTail(normalized);
    return tail ? `<abs>/${tail}` : '<abs>';
  }

  return trimmed;
}

function toIsoTimestamp(value?: number | Date | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function summarizeMessageMeta(message?: Message): MessageMetaSummary | null {
  if (!message) {
    return null;
  }

  return {
    timestamp: toIsoTimestamp(message.timestamp),
    blockTypes: message.content.map((block) => block.type),
    textBlockCount: message.content.filter((block) => block.type === 'text').length,
    imageBlockCount: message.content.filter((block) => block.type === 'image').length,
    fileAttachmentCount: message.content.filter((block) => block.type === 'file_attachment').length,
    toolUseCount: message.content.filter((block) => block.type === 'tool_use').length,
    toolResultCount: message.content.filter((block) => block.type === 'tool_result').length,
  };
}

export function summarizeTraceStepMeta(step: TraceStep): TraceStepMetaSummary {
  return {
    id: step.id,
    type: step.type,
    status: step.status,
    toolName: step.toolName || null,
    timestamp: toIsoTimestamp(step.timestamp),
    durationMs: step.duration ?? null,
    contentLength: step.content?.length ?? 0,
    toolOutputLength: step.toolOutput?.length ?? 0,
    toolInputKeys: step.toolInput ? Object.keys(step.toolInput).slice(0, 12) : [],
    isError: !!step.isError || step.status === 'error',
  };
}

function buildSessionDiagnosticSummary(
  session: Session,
  deps: DiagnosticsSummaryDependencies
): DiagnosticsSummarySessionItem {
  const messages = deps.getMessages(session.id);
  const traceSteps = deps.getTraceSteps(session.id);
  const recentMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp);
  const recentUserMessage = recentMessages.find((message) => message.role === 'user');
  const recentAssistantMessage = recentMessages.find((message) => message.role === 'assistant');
  const errorSteps = traceSteps.filter((step) => step.isError || step.status === 'error');
  const latestErrorStep =
    errorSteps.length > 0
      ? [...errorSteps].sort((a, b) => b.timestamp - a.timestamp)[0]
      : undefined;

  return {
    id: session.id,
    status: session.status,
    cwd: redactFileSystemPath(session.cwd),
    model: session.model || null,
    createdAt: toIsoTimestamp(session.createdAt),
    updatedAt: toIsoTimestamp(session.updatedAt),
    messageCount: messages.length,
    traceStepCount: traceSteps.length,
    errorStepCount: errorSteps.length,
    lastUserMessageMeta: summarizeMessageMeta(recentUserMessage),
    lastAssistantMessageMeta: summarizeMessageMeta(recentAssistantMessage),
    latestErrorStep: latestErrorStep ? summarizeTraceStepMeta(latestErrorStep) : null,
  };
}

export function buildDiagnosticsSummary(input: BuildDiagnosticsSummaryInput): DiagnosticsSummary {
  const sessions = [...input.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const selectedSessions = sessions.slice(0, MAX_DIAGNOSTIC_SESSIONS);
  const sessionSummaries = selectedSessions.map((session) =>
    buildSessionDiagnosticSummary(session, input.deps)
  );

  const recentErrorSteps = selectedSessions
    .flatMap((session) =>
      input.deps
        .getTraceSteps(session.id)
        .filter((step) => step.isError || step.status === 'error')
        .map((step) => ({
          sessionId: session.id,
          step,
        }))
    )
    .sort((a, b) => b.step.timestamp - a.step.timestamp)
    .slice(0, MAX_DIAGNOSTIC_ERROR_STEPS)
    .map(({ sessionId, step }) => ({
      sessionId,
      ...summarizeTraceStepMeta(step),
    }));

  return {
    exportedAt: (input.exportedAt || new Date()).toISOString(),
    app: input.app,
    runtime: {
      ...input.runtime,
      currentWorkingDir: redactFileSystemPath(input.runtime.currentWorkingDir),
      logsDirectory:
        redactFileSystemPath(input.runtime.logsDirectory) || input.runtime.logsDirectory,
    },
    config: {
      ...input.config,
      defaultWorkdir: redactFileSystemPath(input.config.defaultWorkdir),
    },
    sandbox: input.sandbox,
    sessions: {
      total: sessions.length,
      included: sessionSummaries.length,
      items: sessionSummaries,
    },
    recentErrorSteps,
    logFiles: input.logFiles.map((file) => ({
      name: file.name,
      size: file.size,
      modifiedAt: toIsoTimestamp(file.mtime),
    })),
  };
}
