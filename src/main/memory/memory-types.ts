import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { TSchema } from '@sinclair/typebox';
import type { Message, Session } from '../../renderer/types';

export type CoreMemoryCategory = 'identity' | 'preferences' | 'skills' | 'interests';
export type MemorySearchScope = 'workspace' | 'global' | 'all';
export type MemorySearchKind = 'core' | 'experience_session' | 'experience_chunk' | 'raw_session';
export type MemoryNavigationActionType = 'expand_chunk' | 'expand_session' | 'get_raw_session';

export interface MemoryTranscriptTurn {
  role: string;
  content: string;
  messageId?: string;
  timestamp?: number;
}

export interface CoreMemoryActionInput {
  op: 'add' | 'update' | 'upsert' | 'delete';
  category?: CoreMemoryCategory;
  key: string;
  value?: string | null;
  reason?: string;
}

export interface AppliedCoreMemoryAction {
  op: 'add' | 'update' | 'upsert' | 'delete';
  category?: CoreMemoryCategory;
  key: string;
  value?: string | null;
  combinedKey: string;
}

export interface CoreMemoryEntry {
  combinedKey: string;
  category?: CoreMemoryCategory;
  key: string;
  value: string;
}

export interface ChunkMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  details: string;
  keywords: string[];
  sourceTurns: number[];
  rawText: string;
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
}

export interface SessionMemoryItem {
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId: string;
  sourceSessionTitle?: string;
  sourceSessionDate?: string;
  summary: string;
  keywords: string[];
  chunkIds: string[];
  rawSession: MemoryTranscriptTurn[];
  sessionDate: string;
  createdAt: string;
  ingestedAt: string;
  embedding: number[];
}

export interface ProgressiveSummaryItem {
  type: 'chunk' | 'session';
  id: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  summary: string;
}

export interface FocusedChunkItem {
  chunkId: string;
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  details: string;
  summary: string;
  keywords: string[];
  sourceTurns: number[];
}

export interface SessionContextItem {
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  sessionSummary: string;
  sessionDate: string;
  chunkIds: string[];
}

export interface RawSessionCandidateItem {
  sessionId: string;
  sourceWorkspace?: string | null;
  sourceSessionTitle?: string;
  sessionDate: string;
  rawSession: MemoryTranscriptTurn[];
}

export interface ProgressiveRetrievalResult {
  broadSummaries: ProgressiveSummaryItem[];
  focusedChunks: FocusedChunkItem[];
  sessionContexts: SessionContextItem[];
  rawSessionCandidates: RawSessionCandidateItem[];
  finalContext: string;
  rankedChunks: ChunkMemoryItem[];
  rankedSessions: SessionMemoryItem[];
}

export interface NavigationAction {
  type: MemoryNavigationActionType;
  chunkId?: string;
  sessionId?: string;
}

export interface NavigationDecision {
  sufficient: boolean;
  reason: string;
  actions: NavigationAction[];
}

export interface MemorySearchParams {
  query: string;
  cwd?: string;
  workspaceKey?: string | null;
  sourceWorkspace?: string | null;
  scope?: MemorySearchScope;
  limit?: number;
}

export interface MemorySearchResult {
  id: string;
  recordId: string;
  kind: MemorySearchKind;
  title: string;
  summary: string;
  contentPreview: string;
  workspaceKey?: string;
  sourceWorkspace?: string | null;
  sourceWorkspaceLabel?: string;
  sourceSessionId?: string;
  sourceSessionTitle?: string;
  sessionId?: string;
  sessionTitle?: string;
  category?: CoreMemoryCategory;
  score: number;
  createdAt: number;
  updatedAt?: number;
  keywords?: string[];
  sourceFile?: string;
}

export interface MemoryReadResult extends MemorySearchResult {
  rawText?: string;
  details?: string;
  rawSession?: MemoryTranscriptTurn[];
  sourceTurns?: number[];
  chunkIds?: string[];
  sourceExcerpt?: string;
}

export interface MemoryIngestionInput {
  session: Session;
  prompt: string;
  messages: Message[];
}

export interface MemorySessionStateRecord {
  sessionId: string;
  sourceWorkspace?: string | null;
  lastProcessedMessageCount: number;
  lastIngestedAt?: number | null;
  lastError?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryDebugFileInfo {
  kind: 'core' | 'experience' | 'state' | 'artifacts';
  label: string;
  filePath: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: number | null;
  sessionCount?: number;
  chunkCount?: number;
}

export interface MemoryDebugFileContent {
  kind: MemoryDebugFileInfo['kind'];
  filePath: string;
  text: string;
  parsed: unknown | null;
  sizeBytes: number;
  updatedAt: number | null;
}

export interface MemoryInspectSessionResult {
  sourceWorkspace?: string | null;
  filePath: string;
  session: SessionMemoryItem;
  chunks: ChunkMemoryItem[];
}

export interface MemoryOverview {
  enabled: boolean;
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  coreCount: number;
  experienceSessionCount: number;
  experienceChunkCount: number;
  sourceWorkspaceCount: number;
  failedSessionCount: number;
  latestIngestionAt: number | null;
  latestError: string | null;
  currentWorkspace?: {
    workspaceKey: string;
    experienceSessionCount: number;
    experienceChunkCount: number;
  };
  topSourceWorkspaces: Array<{
    workspaceKey: string;
    sessionCount: number;
    chunkCount: number;
  }>;
}

export interface ExperienceSessionExtract {
  sessionSummary: string;
  sessionKeywords: string[];
  chunks: Array<{
    summary: string;
    details: string;
    keywords: string[];
    sourceTurns: number[];
  }>;
}

export interface MemoryToolDefinition extends ToolDefinition<TSchema, unknown> {}
