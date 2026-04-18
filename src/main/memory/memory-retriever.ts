import type {
  CoreMemoryEntry,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  SessionMemoryItem,
} from './memory-types';
import { ExperienceMemoryStore } from './experience-memory-store';
import { lexicalScore, normalizeWorkspaceKey, summarizeText } from './memory-utils';

function buildSearchId(kind: string, recordId: string): string {
  return `${kind}|${encodeURIComponent(recordId)}`;
}

function parseSearchId(id: string): { kind: string; recordId: string } | null {
  const separator = id.indexOf('|');
  if (separator <= 0) {
    return null;
  }
  return {
    kind: id.slice(0, separator),
    recordId: decodeURIComponent(id.slice(separator + 1)),
  };
}

export class MemoryRetriever {
  constructor(
    private readonly deps: {
      getCoreEntries: () => CoreMemoryEntry[];
      getCoreFilePath: () => string;
      getExperienceStore: () => ExperienceMemoryStore;
      getExperienceFilePath: () => string;
      getSessionTitle: (sessionId: string) => string | undefined;
    }
  ) {}

  search(params: MemorySearchParams): MemorySearchResult[] {
    const query = params.query.trim();
    if (!query) {
      return [];
    }

    const requestedWorkspace =
      params.sourceWorkspace ?? params.workspaceKey ?? normalizeWorkspaceKey(params.cwd);
    const normalizedWorkspace = normalizeWorkspaceKey(requestedWorkspace || null);
    const scope = params.scope || (normalizedWorkspace ? 'workspace' : 'all');
    const limit = Math.min(Math.max(params.limit || 8, 1), 50);
    const results: MemorySearchResult[] = [];

    if (scope !== 'workspace') {
      results.push(...this.searchCore(query));
    }
    if (scope !== 'global') {
      results.push(...this.searchExperience(query, normalizedWorkspace));
    }

    return results
      .sort(
        (a, b) =>
          b.score - a.score || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)
      )
      .slice(0, limit);
  }

  read(id: string): MemoryReadResult | null {
    const parsed = parseSearchId(id);
    if (!parsed) {
      return null;
    }
    if (parsed.kind === 'core') {
      return this.readCore(parsed.recordId);
    }

    const store = this.deps.getExperienceStore();
    if (parsed.kind === 'experience_chunk') {
      const chunk = store.getChunk(parsed.recordId);
      if (!chunk) {
        return null;
      }
      return {
        id,
        recordId: parsed.recordId,
        kind: 'experience_chunk',
        title: chunk.summary || chunk.sourceSessionTitle || 'Chunk memory',
        summary: chunk.summary,
        contentPreview: summarizeText(chunk.details || chunk.rawText, 220),
        rawText: chunk.rawText,
        details: chunk.details,
        sourceTurns: chunk.sourceTurns,
        sourceWorkspace: chunk.sourceWorkspace,
        sourceWorkspaceLabel: chunk.sourceWorkspaceLabel,
        workspaceKey: chunk.sourceWorkspace || undefined,
        sourceSessionId: chunk.sourceSessionId,
        sourceSessionTitle: chunk.sourceSessionTitle,
        sessionId: chunk.sessionId,
        sessionTitle: this.deps.getSessionTitle(chunk.sessionId),
        sourceFile: this.deps.getExperienceFilePath(),
        score: 0,
        createdAt: Date.parse(chunk.createdAt) || Date.now(),
        updatedAt: Date.parse(chunk.ingestedAt) || undefined,
        keywords: chunk.keywords,
      };
    }

    const session = store.getSession(parsed.recordId);
    if (!session) {
      return null;
    }
    const chunks = store.getChunksBySession(session.sessionId);
    const rawText = session.rawSession.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
    return {
      id,
      recordId: parsed.recordId,
      kind: parsed.kind === 'raw_session' ? 'raw_session' : 'experience_session',
      title:
        session.sourceSessionTitle ||
        this.deps.getSessionTitle(session.sessionId) ||
        session.summary ||
        'Session memory',
      summary: session.summary,
      contentPreview:
        parsed.kind === 'raw_session'
          ? summarizeText(rawText, 220)
          : summarizeText(session.summary, 220),
      rawText,
      rawSession: session.rawSession,
      sourceWorkspace: session.sourceWorkspace,
      sourceWorkspaceLabel: session.sourceWorkspaceLabel,
      workspaceKey: session.sourceWorkspace || undefined,
      sourceSessionId: session.sourceSessionId,
      sourceSessionTitle: session.sourceSessionTitle,
      sessionId: session.sessionId,
      sessionTitle: this.deps.getSessionTitle(session.sessionId),
      sourceFile: this.deps.getExperienceFilePath(),
      score: 0,
      createdAt: Date.parse(session.createdAt) || Date.now(),
      updatedAt: Date.parse(session.ingestedAt) || undefined,
      keywords: session.keywords,
      chunkIds: chunks.map((chunk) => chunk.id),
    };
  }

  private searchCore(query: string): MemorySearchResult[] {
    return this.deps
      .getCoreEntries()
      .map((entry): MemorySearchResult | null => {
        const score = lexicalScore(query, `${entry.combinedKey} ${entry.value}`);
        if (score <= 0) {
          return null;
        }
        return {
          id: buildSearchId('core', entry.combinedKey),
          recordId: entry.combinedKey,
          kind: 'core',
          title: entry.combinedKey,
          summary: entry.value,
          contentPreview: summarizeText(entry.value, 220),
          category: entry.category,
          sourceFile: this.deps.getCoreFilePath(),
          score,
          createdAt: 0,
          updatedAt: 0,
        };
      })
      .filter((item): item is MemorySearchResult => Boolean(item));
  }

  private searchExperience(query: string, sourceWorkspace: string | null): MemorySearchResult[] {
    const store = this.deps.getExperienceStore();
    const results: MemorySearchResult[] = [];

    for (const item of store.sessions) {
      if (sourceWorkspace && item.sourceWorkspace !== sourceWorkspace) {
        continue;
      }
      const score = lexicalScore(query, [item.summary, ...item.keywords].join(' '));
      if (score <= 0) {
        continue;
      }
      results.push(this.mapSessionResult(item, score));
    }

    for (const item of store.chunks) {
      if (sourceWorkspace && item.sourceWorkspace !== sourceWorkspace) {
        continue;
      }
      const score = lexicalScore(query, [item.summary, item.details, item.rawText, ...item.keywords].join(' '));
      if (score <= 0) {
        continue;
      }
      results.push({
        id: buildSearchId('experience_chunk', item.id),
        recordId: item.id,
        kind: 'experience_chunk',
        title: item.summary || 'Chunk memory',
        summary: item.summary,
        contentPreview: summarizeText(item.details || item.rawText, 220),
        workspaceKey: item.sourceWorkspace || undefined,
        sourceWorkspace: item.sourceWorkspace,
        sourceWorkspaceLabel: item.sourceWorkspaceLabel,
        sourceSessionId: item.sourceSessionId,
        sourceSessionTitle: item.sourceSessionTitle,
        sessionId: item.sessionId,
        sessionTitle: this.deps.getSessionTitle(item.sessionId),
        score,
        createdAt: Date.parse(item.createdAt) || Date.now(),
        updatedAt: Date.parse(item.ingestedAt) || undefined,
        keywords: item.keywords,
        sourceFile: this.deps.getExperienceFilePath(),
      });
    }
    return results;
  }

  private mapSessionResult(item: SessionMemoryItem, score: number): MemorySearchResult {
    return {
      id: buildSearchId('experience_session', item.sessionId),
      recordId: item.sessionId,
      kind: 'experience_session',
      title:
        item.sourceSessionTitle ||
        this.deps.getSessionTitle(item.sessionId) ||
        item.summary ||
        'Session memory',
      summary: item.summary,
      contentPreview: summarizeText(item.summary, 220),
      workspaceKey: item.sourceWorkspace || undefined,
      sourceWorkspace: item.sourceWorkspace,
      sourceWorkspaceLabel: item.sourceWorkspaceLabel,
      sourceSessionId: item.sourceSessionId,
      sourceSessionTitle: item.sourceSessionTitle,
      sessionId: item.sessionId,
      sessionTitle: this.deps.getSessionTitle(item.sessionId),
      score,
      createdAt: Date.parse(item.createdAt) || Date.now(),
      updatedAt: Date.parse(item.ingestedAt) || undefined,
      keywords: item.keywords,
      sourceFile: this.deps.getExperienceFilePath(),
    };
  }

  private readCore(combinedKey: string): MemoryReadResult | null {
    const entry = this.deps.getCoreEntries().find((item) => item.combinedKey === combinedKey);
    if (!entry) {
      return null;
    }
    return {
      id: buildSearchId('core', entry.combinedKey),
      recordId: entry.combinedKey,
      kind: 'core',
      title: entry.combinedKey,
      summary: entry.value,
      contentPreview: summarizeText(entry.value, 220),
      rawText: entry.value,
      category: entry.category,
      score: 0,
      createdAt: 0,
      updatedAt: 0,
      sourceFile: this.deps.getCoreFilePath(),
    };
  }
}
