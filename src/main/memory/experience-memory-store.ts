import { randomUUID } from 'node:crypto';
import type {
  ChunkMemoryItem,
  FocusedChunkItem,
  MemoryTranscriptTurn,
  ProgressiveRetrievalResult,
  RawSessionCandidateItem,
  SessionContextItem,
  SessionMemoryItem,
} from './memory-types';
import {
  cosineSimilarity,
  lexicalScore,
  loadJsonFile,
  normalizeWorkspaceKey,
  saveJsonFile,
} from './memory-utils';

interface ExperienceMemoryFile {
  sessions: Array<Record<string, unknown>>;
  chunks: Array<Record<string, unknown>>;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : [];
}

function normalizeWorkspace(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? normalizeWorkspaceKey(value) : null;
}

function normalizeChunk(item: Record<string, unknown>): ChunkMemoryItem | null {
  if (typeof item.id !== 'string' || typeof item.session_id !== 'string') {
    return null;
  }
  const sessionId = item.session_id;
  return {
    id: item.id,
    sessionId,
    sourceWorkspace: normalizeWorkspace(item.source_workspace),
    sourceWorkspaceLabel:
      typeof item.source_workspace_label === 'string' ? item.source_workspace_label : undefined,
    sourceSessionId:
      typeof item.source_session_id === 'string' ? item.source_session_id : sessionId,
    sourceSessionTitle:
      typeof item.source_session_title === 'string' ? item.source_session_title : undefined,
    sourceSessionDate:
      typeof item.source_session_date === 'string' ? item.source_session_date : undefined,
    summary: typeof item.summary === 'string' ? item.summary : '',
    details:
      typeof item.details === 'string'
        ? item.details
        : typeof item.summary === 'string'
          ? item.summary
          : '',
    keywords: toStringArray(item.keywords),
    sourceTurns: Array.isArray(item.source_turns)
      ? item.source_turns.filter((turn): turn is number => typeof turn === 'number')
      : [],
    rawText: typeof item.raw_text === 'string' ? item.raw_text : '',
    sessionDate: typeof item.session_date === 'string' ? item.session_date : '',
    createdAt: typeof item.created_at === 'string' ? item.created_at : '',
    ingestedAt: typeof item.ingested_at === 'string' ? item.ingested_at : '',
    embedding: toNumberArray(item.embedding),
  };
}

function normalizeSession(item: Record<string, unknown>): SessionMemoryItem | null {
  if (typeof item.id !== 'string' || typeof item.session_id !== 'string') {
    return null;
  }
  const sessionId = item.session_id;
  const rawSession = Array.isArray(item.raw_session)
    ? item.raw_session
        .map((turn): MemoryTranscriptTurn | null => {
          if (!turn || typeof turn !== 'object') {
            return null;
          }
          const normalized: MemoryTranscriptTurn = {
            role:
              typeof (turn as { role?: unknown }).role === 'string'
                ? (turn as { role: string }).role
                : 'unknown',
            content:
              typeof (turn as { content?: unknown }).content === 'string'
                ? (turn as { content: string }).content
                : '',
          };
          if (typeof (turn as { messageId?: unknown }).messageId === 'string') {
            normalized.messageId = (turn as { messageId: string }).messageId;
          }
          if (typeof (turn as { timestamp?: unknown }).timestamp === 'number') {
            normalized.timestamp = (turn as { timestamp: number }).timestamp;
          }
          return normalized;
        })
        .filter((turn): turn is MemoryTranscriptTurn => Boolean(turn))
    : [];

  return {
    id: item.id,
    sessionId,
    sourceWorkspace: normalizeWorkspace(item.source_workspace),
    sourceWorkspaceLabel:
      typeof item.source_workspace_label === 'string' ? item.source_workspace_label : undefined,
    sourceSessionId:
      typeof item.source_session_id === 'string' ? item.source_session_id : sessionId,
    sourceSessionTitle:
      typeof item.source_session_title === 'string' ? item.source_session_title : undefined,
    sourceSessionDate:
      typeof item.source_session_date === 'string' ? item.source_session_date : undefined,
    summary: typeof item.summary === 'string' ? item.summary : '',
    keywords: toStringArray(item.keywords),
    chunkIds: toStringArray(item.chunk_ids),
    rawSession,
    sessionDate: typeof item.session_date === 'string' ? item.session_date : '',
    createdAt: typeof item.created_at === 'string' ? item.created_at : '',
    ingestedAt: typeof item.ingested_at === 'string' ? item.ingested_at : '',
    embedding: toNumberArray(item.embedding),
  };
}

function chunkToFileRecord(item: ChunkMemoryItem): Record<string, unknown> {
  return {
    id: item.id,
    session_id: item.sessionId,
    source_workspace: item.sourceWorkspace ?? null,
    source_workspace_label: item.sourceWorkspaceLabel ?? '',
    source_session_id: item.sourceSessionId,
    source_session_title: item.sourceSessionTitle ?? '',
    source_session_date: item.sourceSessionDate ?? '',
    summary: item.summary,
    details: item.details,
    keywords: item.keywords,
    source_turns: item.sourceTurns,
    raw_text: item.rawText,
    session_date: item.sessionDate,
    created_at: item.createdAt,
    ingested_at: item.ingestedAt,
    embedding: item.embedding,
  };
}

function sessionToFileRecord(item: SessionMemoryItem): Record<string, unknown> {
  return {
    id: item.id,
    session_id: item.sessionId,
    source_workspace: item.sourceWorkspace ?? null,
    source_workspace_label: item.sourceWorkspaceLabel ?? '',
    source_session_id: item.sourceSessionId,
    source_session_title: item.sourceSessionTitle ?? '',
    source_session_date: item.sourceSessionDate ?? '',
    summary: item.summary,
    keywords: item.keywords,
    chunk_ids: item.chunkIds,
    raw_session: item.rawSession,
    session_date: item.sessionDate,
    created_at: item.createdAt,
    ingested_at: item.ingestedAt,
    embedding: item.embedding,
  };
}

function workspaceBoost(currentWorkspace: string | null, sourceWorkspace?: string | null): number {
  if (!currentWorkspace) {
    return sourceWorkspace ? 0 : -0.03;
  }
  if (sourceWorkspace === currentWorkspace) {
    return 0.3;
  }
  if (!sourceWorkspace) {
    return -0.04;
  }
  return 0;
}

function recencyBoost(ingestedAt: string, now = Date.now()): number {
  const timestamp = Date.parse(ingestedAt);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }
  const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
  if (ageDays <= 3) {
    return 0.08;
  }
  if (ageDays <= 14) {
    return 0.04;
  }
  if (ageDays <= 45) {
    return 0.02;
  }
  return 0;
}

export class ExperienceMemoryStore {
  readonly sessions: SessionMemoryItem[];
  readonly chunks: ChunkMemoryItem[];
  private readonly chunkIndex = new Map<string, ChunkMemoryItem>();
  private readonly sessionIndex = new Map<string, SessionMemoryItem>();

  constructor(private readonly filePath: string) {
    const raw = loadJsonFile<ExperienceMemoryFile>(filePath, {
      sessions: [],
      chunks: [],
    });
    this.sessions = (raw.sessions || [])
      .map((item) => normalizeSession(item))
      .filter((item): item is SessionMemoryItem => Boolean(item));
    this.chunks = (raw.chunks || [])
      .map((item) => normalizeChunk(item))
      .filter((item): item is ChunkMemoryItem => Boolean(item));

    for (const item of this.sessions) {
      this.sessionIndex.set(item.sessionId, item);
    }
    for (const item of this.chunks) {
      this.chunkIndex.set(item.id, item);
    }
  }

  getPath(): string {
    return this.filePath;
  }

  getSession(sessionId: string): SessionMemoryItem | undefined {
    return this.sessionIndex.get(sessionId);
  }

  getChunk(chunkId: string): ChunkMemoryItem | undefined {
    return this.chunkIndex.get(chunkId);
  }

  getChunksBySession(sessionId: string): ChunkMemoryItem[] {
    const session = this.getSession(sessionId);
    if (!session) {
      return [];
    }
    return session.chunkIds
      .map((chunkId) => this.chunkIndex.get(chunkId))
      .filter((item): item is ChunkMemoryItem => Boolean(item));
  }

  getStatsBySourceWorkspace(): Array<{ workspaceKey: string; sessionCount: number; chunkCount: number }> {
    const stats = new Map<string, { workspaceKey: string; sessionCount: number; chunkCount: number }>();
    for (const session of this.sessions) {
      const key = session.sourceWorkspace || '(none)';
      const current = stats.get(key) || { workspaceKey: key, sessionCount: 0, chunkCount: 0 };
      current.sessionCount += 1;
      stats.set(key, current);
    }
    for (const chunk of this.chunks) {
      const key = chunk.sourceWorkspace || '(none)';
      const current = stats.get(key) || { workspaceKey: key, sessionCount: 0, chunkCount: 0 };
      current.chunkCount += 1;
      stats.set(key, current);
    }
    return [...stats.values()].sort((a, b) => b.sessionCount + b.chunkCount - (a.sessionCount + a.chunkCount));
  }

  replaceSession(
    sessionId: string,
    sessionInput: Omit<SessionMemoryItem, 'id'> & { id?: string },
    chunkInputs: Array<Omit<ChunkMemoryItem, 'id'> & { id?: string }>
  ): SessionMemoryItem {
    this.removeSession(sessionId);

    const chunks = chunkInputs.map((item) => {
      const chunk: ChunkMemoryItem = {
        ...item,
        id: item.id || randomUUID(),
      };
      this.chunks.push(chunk);
      this.chunkIndex.set(chunk.id, chunk);
      return chunk;
    });

    const session: SessionMemoryItem = {
      ...sessionInput,
      id: sessionInput.id || randomUUID(),
      chunkIds: chunks.map((chunk) => chunk.id),
    };
    this.sessions.push(session);
    this.sessionIndex.set(session.sessionId, session);
    return session;
  }

  removeSession(sessionId: string): void {
    const existing = this.sessionIndex.get(sessionId);
    if (!existing) {
      return;
    }
    this.sessionIndex.delete(sessionId);
    const nextSessions = this.sessions.filter((item) => item.sessionId !== sessionId);
    this.sessions.splice(0, this.sessions.length, ...nextSessions);

    const chunkIds = new Set(existing.chunkIds);
    for (const chunkId of chunkIds) {
      this.chunkIndex.delete(chunkId);
    }
    const nextChunks = this.chunks.filter((item) => !chunkIds.has(item.id));
    this.chunks.splice(0, this.chunks.length, ...nextChunks);
  }

  removeBySourceWorkspace(sourceWorkspace: string): void {
    const normalized = normalizeWorkspaceKey(sourceWorkspace);
    if (!normalized) {
      return;
    }
    for (const session of [...this.sessions]) {
      if (session.sourceWorkspace === normalized) {
        this.removeSession(session.sessionId);
      }
    }
  }

  clear(): void {
    this.sessions.splice(0, this.sessions.length);
    this.chunks.splice(0, this.chunks.length);
    this.sessionIndex.clear();
    this.chunkIndex.clear();
    this.save();
  }

  save(): void {
    saveJsonFile(this.filePath, {
      sessions: this.sessions.map(sessionToFileRecord),
      chunks: this.chunks.map(chunkToFileRecord),
    });
  }

  retrieveProgressive(
    query: string,
    options?: {
      chunkTopK?: number;
      sessionTopK?: number;
      queryEmbedding?: number[];
      currentWorkspace?: string | null;
    }
  ): ProgressiveRetrievalResult {
    const chunkTopK = options?.chunkTopK ?? 10;
    const sessionTopK = options?.sessionTopK ?? 5;
    const currentWorkspace = normalizeWorkspaceKey(options?.currentWorkspace || null);
    const queryEmbedding = options?.queryEmbedding;

    const rankedChunks = this.rankItems(query, this.chunks, chunkTopK, queryEmbedding, currentWorkspace, (item) => [
      item.summary,
      item.details,
      item.rawText,
      ...item.keywords,
      item.sourceWorkspace || '',
      item.sourceSessionTitle || '',
    ].join(' '));
    const rankedSessions = this.rankItems(
      query,
      this.sessions,
      sessionTopK,
      queryEmbedding,
      currentWorkspace,
      (item) => [item.summary, ...item.keywords, item.sourceWorkspace || '', item.sourceSessionTitle || ''].join(' ')
    );

    const broadSummaries = [
      ...rankedChunks.map(
        (item): { score: number; payload: ProgressiveRetrievalResult['broadSummaries'][number] } => ({
          score: item.score,
          payload: {
            type: 'chunk',
            id: item.record.id,
            sessionId: item.record.sessionId,
            sourceWorkspace: item.record.sourceWorkspace,
            sourceSessionTitle: item.record.sourceSessionTitle,
            summary: item.record.summary,
          },
        })
      ),
      ...rankedSessions.map(
        (item): { score: number; payload: ProgressiveRetrievalResult['broadSummaries'][number] } => ({
          score: item.score,
          payload: {
            type: 'session',
            id: item.record.sessionId,
            sessionId: item.record.sessionId,
            sourceWorkspace: item.record.sourceWorkspace,
            sourceSessionTitle: item.record.sourceSessionTitle,
            summary: item.record.summary,
          },
        })
      ),
    ]
      .sort((a, b) => b.score - a.score)
      .map((item) => item.payload);

    const focusedChunks: FocusedChunkItem[] = rankedChunks.map((item) => ({
      chunkId: item.record.id,
      sessionId: item.record.sessionId,
      sourceWorkspace: item.record.sourceWorkspace,
      sourceSessionTitle: item.record.sourceSessionTitle,
      details: item.record.details,
      summary: item.record.summary,
      keywords: item.record.keywords,
      sourceTurns: item.record.sourceTurns,
    }));

    const sessionContexts: SessionContextItem[] = rankedSessions.map((item) => ({
      sessionId: item.record.sessionId,
      sourceWorkspace: item.record.sourceWorkspace,
      sourceSessionTitle: item.record.sourceSessionTitle,
      sessionSummary: item.record.summary,
      sessionDate: item.record.sessionDate,
      chunkIds: item.record.chunkIds,
    }));

    const rawSessionCandidates: RawSessionCandidateItem[] = rankedSessions.map((item) => ({
      sessionId: item.record.sessionId,
      sourceWorkspace: item.record.sourceWorkspace,
      sourceSessionTitle: item.record.sourceSessionTitle,
      sessionDate: item.record.sessionDate,
      rawSession: item.record.rawSession,
    }));

    return {
      broadSummaries,
      focusedChunks,
      sessionContexts,
      rawSessionCandidates,
      finalContext: '',
      rankedChunks: rankedChunks.map((item) => item.record),
      rankedSessions: rankedSessions.map((item) => item.record),
    };
  }

  private rankItems<T extends { embedding: number[]; ingestedAt: string; sourceWorkspace?: string | null }>(
    query: string,
    items: T[],
    topK: number,
    queryEmbedding: number[] | undefined,
    currentWorkspace: string | null,
    textSelector: (item: T) => string
  ): Array<{ record: T; score: number }> {
    return items
      .map((record) => {
        const lexical = lexicalScore(query, textSelector(record));
        const embedding =
          queryEmbedding && queryEmbedding.length && record.embedding.length
            ? cosineSimilarity(queryEmbedding, record.embedding)
            : 0;
        const evidenceScore = lexical + embedding;
        const score =
          evidenceScore +
          workspaceBoost(currentWorkspace, record.sourceWorkspace) +
          recencyBoost(record.ingestedAt);
        return { record, score, evidenceScore };
      })
      .filter((item) => item.evidenceScore > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
