import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../config/config-store';
import { configStore } from '../config/config-store';
import type { DatabaseInstance, SessionRow } from '../db/database';
import { log, logError, logWarn } from '../utils/logger';
import { CoreMemoryStore } from './core-memory-store';
import { CoreMemoryExtractor } from './core-memory-extractor';
import { ExperienceMemoryExtractor } from './experience-memory-extractor';
import { ExperienceMemoryStore } from './experience-memory-store';
import { MemoryIngestionQueue } from './memory-ingestion-queue';
import type { MemoryLLMClientLike } from './memory-llm-client';
import { MemoryLLMClient } from './memory-llm-client';
import { MemoryNavigator } from './memory-navigator';
import { DEFAULT_MEMORY_PROMPTS, type MemoryPromptSet } from './memory-prompts';
import { MemoryRetriever } from './memory-retriever';
import { MemorySessionStateStore } from './memory-state-store';
import type {
  ChunkMemoryItem,
  MemoryDebugFileContent,
  MemoryDebugFileInfo,
  MemoryIngestionInput,
  MemoryInspectSessionResult,
  MemoryOverview,
  MemoryReadResult,
  MemorySearchParams,
  MemorySearchResult,
  MemoryToolDefinition,
  MemoryTranscriptTurn,
  ProgressiveRetrievalResult,
} from './memory-types';
import {
  extractKeywords,
  formatTimestamp,
  getFileSizeBytes,
  getFileTimestampMs,
  isSubPath,
  isoNow,
  loadJsonFile,
  messagesToTranscript,
  normalizeWorkspaceKey,
  safeRemoveFile,
} from './memory-utils';
import { createMemoryTools } from './memory-tools';

interface MemoryPaths {
  storageRoot: string;
  coreFilePath: string;
  experienceFilePath: string;
  stateFilePath: string;
  artifactsDir: string;
}

interface ExtractionBundle {
  sessionRow: SessionRow;
  session: MemoryIngestionInput['session'];
  sourceWorkspace: string | null;
  sessionDate: string;
  fullMessages: MemoryIngestionInput['messages'];
  fullTurns: MemoryTranscriptTurn[];
  extracted: Awaited<ReturnType<ExperienceMemoryExtractor['extractSession']>>;
}

interface ExpandedChunkData {
  rawText: string;
  keywords: string[];
  sessionId: string;
  sourceWorkspace: string | null;
}

interface ExpandedSessionData {
  summary: string;
  keywords: string[];
  sessionDate: string;
  sourceWorkspace: string | null;
  sourceSessionTitle?: string;
  chunks: Array<{ chunkId: string; summary: string; keywords: string[] }>;
}

export class MemoryService {
  private readonly queue = new MemoryIngestionQueue();
  private readonly deletedSessionIds = new Set<string>();
  private readonly llmClient: MemoryLLMClientLike;
  private readonly coreExtractor: CoreMemoryExtractor;
  private readonly experienceExtractor: ExperienceMemoryExtractor;
  private readonly navigator: MemoryNavigator;
  private readonly retriever: MemoryRetriever;
  private readonly tools: MemoryToolDefinition[];
  private currentStorageRoot: string | null = null;
  private coreStore: CoreMemoryStore | null = null;
  private stateStore: MemorySessionStateStore | null = null;
  private experienceStore: ExperienceMemoryStore | null = null;

  constructor(
    private readonly db: DatabaseInstance,
    options?: {
      llmClient?: MemoryLLMClientLike;
      prompts?: Partial<MemoryPromptSet>;
    }
  ) {
    this.llmClient = options?.llmClient || new MemoryLLMClient();
    const promptSet: MemoryPromptSet = {
      ...DEFAULT_MEMORY_PROMPTS,
      ...options?.prompts,
    };
    this.coreExtractor = new CoreMemoryExtractor(this.llmClient, promptSet.coreMemoryUpdateSystemPrompt);
    this.experienceExtractor = new ExperienceMemoryExtractor(
      this.llmClient,
      promptSet.sessionChunkExtractionPrompt
    );
    this.navigator = new MemoryNavigator(this.llmClient, promptSet.memoryNavigationPrompt);
    this.retriever = new MemoryRetriever({
      getCoreEntries: () => this.getCoreStore().getEntries(),
      getCoreFilePath: () => this.getPaths().coreFilePath,
      getExperienceStore: () => this.getExperienceStore(),
      getExperienceFilePath: () => this.getPaths().experienceFilePath,
      getSessionTitle: (sessionId) => this.getSessionTitle(sessionId),
    });
    this.tools = createMemoryTools(this);
  }

  isEnabled(): boolean {
    return configStore.get('memoryEnabled') !== false;
  }

  setEnabled(enabled: boolean): { success: boolean; enabled: boolean } {
    configStore.update({ memoryEnabled: enabled });
    return { success: true, enabled };
  }

  getTools(): MemoryToolDefinition[] {
    return this.tools;
  }

  search(params: MemorySearchParams): MemorySearchResult[] {
    return this.retriever.search(params);
  }

  read(id: string): MemoryReadResult | null {
    return this.retriever.read(id);
  }

  getOverview(cwd?: string): MemoryOverview {
    const paths = this.getPaths();
    const coreEntries = this.getCoreStore().getEntries();
    const experienceStore = this.getExperienceStore();
    const stateRecords = this.getStateStore().getAll();
    const currentWorkspace = normalizeWorkspaceKey(cwd);
    const topSourceWorkspaces = experienceStore.getStatsBySourceWorkspace();

    return {
      enabled: this.isEnabled(),
      storageRoot: paths.storageRoot,
      coreFilePath: paths.coreFilePath,
      experienceFilePath: paths.experienceFilePath,
      stateFilePath: paths.stateFilePath,
      coreCount: coreEntries.length,
      experienceSessionCount: experienceStore.sessions.length,
      experienceChunkCount: experienceStore.chunks.length,
      sourceWorkspaceCount: topSourceWorkspaces.filter((item) => item.workspaceKey !== '(none)').length,
      failedSessionCount: stateRecords.filter((record) => Boolean(record.lastError)).length,
      latestIngestionAt: stateRecords.reduce<number | null>((latest, record) => {
        if (!record.lastIngestedAt) {
          return latest;
        }
        return latest === null ? record.lastIngestedAt : Math.max(latest, record.lastIngestedAt);
      }, null),
      latestError:
        stateRecords
          .filter((record) => record.lastError)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.lastError || null,
      currentWorkspace: currentWorkspace
        ? {
            workspaceKey: currentWorkspace,
            experienceSessionCount: experienceStore.sessions.filter(
              (item) => item.sourceWorkspace === currentWorkspace
            ).length,
            experienceChunkCount: experienceStore.chunks.filter(
              (item) => item.sourceWorkspace === currentWorkspace
            ).length,
          }
        : undefined,
      topSourceWorkspaces,
    };
  }

  listFiles(): MemoryDebugFileInfo[] {
    const paths = this.getPaths();
    const experienceStore = this.getExperienceStore();
    return [
      {
        kind: 'core',
        label: 'core_memory.json',
        filePath: paths.coreFilePath,
        exists: fs.existsSync(paths.coreFilePath),
        sizeBytes: getFileSizeBytes(paths.coreFilePath),
        updatedAt: getFileTimestampMs(paths.coreFilePath),
      },
      {
        kind: 'experience',
        label: 'experience_memory.json',
        filePath: paths.experienceFilePath,
        exists: fs.existsSync(paths.experienceFilePath),
        sizeBytes: getFileSizeBytes(paths.experienceFilePath),
        updatedAt: getFileTimestampMs(paths.experienceFilePath),
        sessionCount: experienceStore.sessions.length,
        chunkCount: experienceStore.chunks.length,
      },
      {
        kind: 'state',
        label: 'session_state.json',
        filePath: paths.stateFilePath,
        exists: fs.existsSync(paths.stateFilePath),
        sizeBytes: getFileSizeBytes(paths.stateFilePath),
        updatedAt: getFileTimestampMs(paths.stateFilePath),
      },
      {
        kind: 'artifacts',
        label: 'eval-artifacts/',
        filePath: paths.artifactsDir,
        exists: fs.existsSync(paths.artifactsDir),
        sizeBytes: getFileSizeBytes(paths.artifactsDir),
        updatedAt: getFileTimestampMs(paths.artifactsDir),
      },
    ];
  }

  readFile(filePath: string): MemoryDebugFileContent {
    const normalizedPath = this.resolveReadablePath(filePath);
    const stat = fs.statSync(normalizedPath);
    if (stat?.isDirectory()) {
      const entries = fs.readdirSync(normalizedPath).sort();
      const parsed = entries.map((name) => {
        const fullPath = path.join(normalizedPath, name);
        const child = fs.statSync(fullPath);
        return {
          name,
          path: fullPath,
          isDirectory: child.isDirectory(),
          sizeBytes: child.size,
          updatedAt: child.mtimeMs,
        };
      });
      return {
        kind: 'artifacts',
        filePath: normalizedPath,
        text: JSON.stringify(parsed, null, 2),
        parsed,
        sizeBytes: stat.size,
        updatedAt: stat.mtimeMs,
      };
    }
    const raw = stat ? fs.readFileSync(normalizedPath, 'utf8') : '';
    return {
      kind: this.resolveFileKind(normalizedPath),
      filePath: normalizedPath,
      text: raw,
      parsed: raw.trim() ? loadJsonFile(normalizedPath, null) : null,
      sizeBytes: getFileSizeBytes(normalizedPath),
      updatedAt: getFileTimestampMs(normalizedPath),
    };
  }

  inspectSession(sessionId: string, sourceWorkspace?: string): MemoryInspectSessionResult | null {
    const store = this.getExperienceStore();
    const session = store.getSession(sessionId);
    if (!session) {
      return null;
    }
    if (sourceWorkspace) {
      const normalized = normalizeWorkspaceKey(sourceWorkspace);
      if (session.sourceWorkspace !== normalized) {
        return null;
      }
    }
    return {
      sourceWorkspace: session.sourceWorkspace,
      filePath: store.getPath(),
      session,
      chunks: store.getChunksBySession(sessionId),
    };
  }

  async buildPromptPrefix(session: { cwd?: string }, prompt: string): Promise<string> {
    if (!this.isEnabled()) {
      return '';
    }

    const sections: string[] = [];
    const corePromptBlock = this.getCoreStore().toPromptBlock();
    if (corePromptBlock !== 'None') {
      sections.push(`<core_memory>\n${corePromptBlock}\n</core_memory>`);
    }

    const experienceContext = await this.buildExperienceContext(prompt, normalizeWorkspaceKey(session.cwd));
    if (experienceContext.trim()) {
      sections.push(`<experience_memory>\n${experienceContext}\n</experience_memory>`);
    }

    if (!sections.length) {
      return '';
    }

    return [
      '<memory_context>',
      'Use the following saved memory when it is relevant to the current request.',
      'Treat the source workspace/session markers as provenance metadata.',
      'Prefer directly expanded evidence over broad summaries when both are present.',
      ...sections,
      '</memory_context>',
    ].join('\n');
  }

  enqueueIngestion(input: MemoryIngestionInput): Promise<void> {
    if (!input.session.memoryEnabled) {
      return Promise.resolve();
    }
    return this.queue.enqueue(input.session.id, async () => {
      await this.ingest(input);
    });
  }

  async rebuildWorkspace(cwd: string): Promise<{ success: boolean; workspaceKey: string }> {
    const workspaceKey = normalizeWorkspaceKey(cwd);
    if (!workspaceKey) {
      throw new Error('Workspace path is required');
    }

    this.clearWorkspace(cwd);
    const sessionRows = this.db.sessions
      .getAll()
      .filter((session) => normalizeWorkspaceKey(session.cwd) === workspaceKey && session.memory_enabled === 1)
      .sort((a, b) => a.created_at - b.created_at);

    await this.batchRebuild(sessionRows);
    return { success: true, workspaceKey };
  }

  async rebuildAll(): Promise<{ success: boolean; workspaceCount: number; sessionCount: number }> {
    const paths = this.getPaths();
    safeRemoveFile(paths.coreFilePath);
    safeRemoveFile(paths.experienceFilePath);
    safeRemoveFile(paths.stateFilePath);
    fs.rmSync(paths.artifactsDir, { recursive: true, force: true });
    this.resetStores();

    const sessionRows = this.db.sessions
      .getAll()
      .filter((session) => session.memory_enabled === 1)
      .sort((a, b) => a.created_at - b.created_at);
    await this.batchRebuild(sessionRows);
    const overview = this.getOverview();
    return {
      success: true,
      workspaceCount: overview.sourceWorkspaceCount,
      sessionCount: sessionRows.length,
    };
  }

  clearWorkspace(cwd: string): { success: boolean; workspaceKey: string } {
    const workspaceKey = normalizeWorkspaceKey(cwd);
    if (!workspaceKey) {
      throw new Error('Workspace path is required');
    }

    const store = this.getExperienceStore();
    store.removeBySourceWorkspace(workspaceKey);
    store.save();
    this.getStateStore().deleteBySourceWorkspace(workspaceKey);
    return { success: true, workspaceKey };
  }

  clearCoreMemory(): { success: boolean } {
    this.getCoreStore().clear();
    return { success: true };
  }

  deleteSession(sessionId: string): Promise<void> {
    this.deletedSessionIds.add(sessionId);
    return this.queue.enqueue(sessionId, async () => {
      const store = this.getExperienceStore();
      if (store.getSession(sessionId)) {
        store.removeSession(sessionId);
        store.save();
      }
      this.getStateStore().delete(sessionId);
    });
  }

  private async batchRebuild(sessionRows: SessionRow[]): Promise<void> {
    if (!sessionRows.length) {
      return;
    }
    const bundles = await this.extractExperienceBundles(sessionRows);
    const sortedBundles = [...bundles].sort((a, b) => a.session.createdAt - b.session.createdAt);
    for (const bundle of sortedBundles) {
      await this.ingestExtractedBundle(bundle);
    }
  }

  private async ingest(input: MemoryIngestionInput): Promise<void> {
    const { session, messages } = input;
    if (!session.memoryEnabled || !messages.length) {
      return;
    }

    if (this.deletedSessionIds.has(session.id)) {
      this.getStateStore().delete(session.id);
      return;
    }

    const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
    const stateStore = this.getStateStore();
    const previousState = stateStore.get(session.id);
    const lastProcessedMessageCount = previousState?.lastProcessedMessageCount || 0;

    if (messages.length <= lastProcessedMessageCount) {
      return;
    }

    const fullTurns = messagesToTranscript(messages);
    const deltaTurns = messagesToTranscript(messages.slice(lastProcessedMessageCount));
    const sessionDate = this.resolveSessionDate(session, messages);

    try {
      await this.updateCoreMemory(session.id, sessionDate, deltaTurns);
      if (this.deletedSessionIds.has(session.id)) {
        stateStore.delete(session.id);
        return;
      }
      if (fullTurns.length) {
        const extracted = await this.experienceExtractor.extractSession({
          sessionId: session.id,
          sessionDate,
          turns: fullTurns,
        });
        if (this.deletedSessionIds.has(session.id)) {
          stateStore.delete(session.id);
          return;
        }
        await this.storeExperienceSession({
          sourceWorkspace,
          sessionId: session.id,
          sessionTitle: session.title,
          sessionDate,
          sessionCreatedAt: session.createdAt,
          fullTurns,
          extracted,
        });
      }

      stateStore.set({
        sessionId: session.id,
        sourceWorkspace,
        lastProcessedMessageCount: messages.length,
        lastIngestedAt: Date.now(),
        lastError: null,
        createdAt: previousState?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
      log('[MemoryService] Ingested memory for session:', session.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('[MemoryService] Failed to ingest memory:', error);
      stateStore.set({
        sessionId: session.id,
        sourceWorkspace,
        lastProcessedMessageCount,
        lastIngestedAt: previousState?.lastIngestedAt || null,
        lastError: message,
        createdAt: previousState?.createdAt || Date.now(),
        updatedAt: Date.now(),
      });
    }
  }

  private async ingestExtractedBundle(bundle: ExtractionBundle): Promise<void> {
    await this.updateCoreMemory(bundle.session.id, bundle.sessionDate, bundle.fullTurns);
    if (bundle.fullTurns.length) {
      await this.storeExperienceSession({
        sourceWorkspace: bundle.sourceWorkspace,
        sessionId: bundle.session.id,
        sessionTitle: bundle.session.title,
        sessionDate: bundle.sessionDate,
        sessionCreatedAt: bundle.session.createdAt,
        fullTurns: bundle.fullTurns,
        extracted: bundle.extracted,
      });
    }
    this.getStateStore().set({
      sessionId: bundle.session.id,
      sourceWorkspace: bundle.sourceWorkspace,
      lastProcessedMessageCount: bundle.fullMessages.length,
      lastIngestedAt: Date.now(),
      lastError: null,
      createdAt: bundle.session.createdAt,
      updatedAt: Date.now(),
    });
  }

  private async extractExperienceBundles(sessionRows: SessionRow[]): Promise<ExtractionBundle[]> {
    const concurrency = this.getAppConfig().memoryRuntime.ingestionConcurrency;
    const tasks = sessionRows.map((sessionRow) => async () => {
      const session = this.sessionRowToSession(sessionRow);
      const fullMessages = this.getMessagesForSession(sessionRow.id);
      const fullTurns = messagesToTranscript(fullMessages);
      const sessionDate = this.resolveSessionDate(session, fullMessages);
      const sourceWorkspace = normalizeWorkspaceKey(session.cwd);
      const extracted = fullTurns.length
        ? await this.experienceExtractor.extractSession({
            sessionId: session.id,
            sessionDate,
            turns: fullTurns,
          })
        : { sessionSummary: '', sessionKeywords: [], chunks: [] };
      return {
        sessionRow,
        session,
        sourceWorkspace,
        sessionDate,
        fullMessages,
        fullTurns,
        extracted,
      } satisfies ExtractionBundle;
    });

    const bundles: ExtractionBundle[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        bundles[index] = await tasks[index]();
      }
    });
    await Promise.all(workers);
    return bundles.filter(Boolean);
  }

  private async updateCoreMemory(
    sessionId: string,
    sessionDate: string,
    turns: MemoryTranscriptTurn[]
  ): Promise<void> {
    if (!turns.length) {
      return;
    }
    const coreStore = this.getCoreStore();
    const actions = await this.coreExtractor.extract({
      sessionId,
      sessionDate,
      turns,
      existingCorePromptBlock: coreStore.toPromptBlock(),
    });
    if (actions.length) {
      coreStore.applyActions(actions);
    }
  }

  private async storeExperienceSession(input: {
    sourceWorkspace: string | null;
    sessionId: string;
    sessionTitle?: string;
    sessionDate: string;
    sessionCreatedAt: number;
    fullTurns: MemoryTranscriptTurn[];
    extracted: Awaited<ReturnType<ExperienceMemoryExtractor['extractSession']>>;
  }): Promise<void> {
    const store = this.getExperienceStore();
    const existing = store.getSession(input.sessionId);
    const ingestedAt = isoNow();
    const sourceWorkspaceLabel = this.resolveWorkspaceLabel(input.sourceWorkspace);

    const chunkInputs: Array<Omit<ChunkMemoryItem, 'id'>> = [];
    for (const chunk of input.extracted.chunks) {
      const rawText = this.extractRawText(input.fullTurns, chunk.sourceTurns);
      const searchableText = [chunk.summary, chunk.details, ...chunk.keywords].join(' ').trim();
      chunkInputs.push({
        sessionId: input.sessionId,
        sourceWorkspace: input.sourceWorkspace,
        sourceWorkspaceLabel,
        sourceSessionId: input.sessionId,
        sourceSessionTitle: input.sessionTitle,
        sourceSessionDate: input.sessionDate,
        summary: chunk.summary,
        details: chunk.details,
        keywords: chunk.keywords.length ? chunk.keywords : extractKeywords(searchableText),
        sourceTurns: chunk.sourceTurns,
        rawText,
        sessionDate: input.sessionDate,
        createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
        ingestedAt,
        embedding: await this.embedText(searchableText),
      });
    }

    const sessionSearchable = [input.extracted.sessionSummary, ...input.extracted.sessionKeywords].join(' ').trim();
    store.replaceSession(
      input.sessionId,
      {
        sessionId: input.sessionId,
        sourceWorkspace: input.sourceWorkspace,
        sourceWorkspaceLabel,
        sourceSessionId: input.sessionId,
        sourceSessionTitle: input.sessionTitle,
        sourceSessionDate: input.sessionDate,
        summary: input.extracted.sessionSummary,
        keywords:
          input.extracted.sessionKeywords.length
            ? input.extracted.sessionKeywords
            : extractKeywords(sessionSearchable),
        chunkIds: [],
        rawSession: input.fullTurns,
        sessionDate: input.sessionDate,
        createdAt: existing?.createdAt || new Date(input.sessionCreatedAt).toISOString(),
        ingestedAt,
        embedding: await this.embedText(sessionSearchable),
      },
      chunkInputs
    );
    store.save();
  }

  private async buildExperienceContext(prompt: string, currentWorkspace: string | null): Promise<string> {
    if (!prompt.trim()) {
      return '';
    }
    const store = this.getExperienceStore();
    if (!store.sessions.length && !store.chunks.length) {
      return '';
    }
    const queryEmbedding = await this.embedText(prompt);
    const retrieval = store.retrieveProgressive(prompt, {
      chunkTopK: 10,
      sessionTopK: 5,
      queryEmbedding,
      currentWorkspace,
    });
    if (!retrieval.broadSummaries.length) {
      return '';
    }

    let visibleContext = this.formatSummariesOnly(retrieval);
    const expandedChunks = new Map<string, ExpandedChunkData>();
    const expandedSessions = new Map<string, ExpandedSessionData>();
    const rawSessions = new Map<string, string>();

    for (let step = 0; step < this.getAppConfig().memoryRuntime.maxNavSteps; step += 1) {
      const decision = await this.navigator.decide(prompt, formatTimestamp(Date.now()), visibleContext);
      if (decision.sufficient || decision.actions.length === 0) {
        break;
      }
      for (const action of decision.actions) {
        if (action.type === 'expand_chunk' && action.chunkId) {
          const chunk = store.getChunk(action.chunkId);
          if (chunk) {
            expandedChunks.set(action.chunkId, {
              rawText: chunk.rawText,
              keywords: chunk.keywords,
              sessionId: chunk.sessionId,
              sourceWorkspace: chunk.sourceWorkspace || null,
            });
          }
        }
        if (action.type === 'expand_session' && action.sessionId) {
          const session = store.getSession(action.sessionId);
          if (session) {
            expandedSessions.set(action.sessionId, {
              summary: session.summary,
              keywords: session.keywords,
              sessionDate: session.sessionDate,
              sourceWorkspace: session.sourceWorkspace || null,
              sourceSessionTitle: session.sourceSessionTitle,
              chunks: store.getChunksBySession(action.sessionId).map((chunk) => ({
                chunkId: chunk.id,
                summary: chunk.summary,
                keywords: chunk.keywords,
              })),
            });
          }
        }
        if (action.type === 'get_raw_session' && action.sessionId) {
          const session = store.getSession(action.sessionId);
          if (session) {
            rawSessions.set(
              action.sessionId,
              `[Raw Session ${action.sessionId} | Date: ${session.sessionDate} | Source: ${session.sourceWorkspace || 'global'}]\n${JSON.stringify(
                session.rawSession,
                null,
                2
              )}`
            );
          }
        }
      }
      visibleContext = this.formatFullContext(retrieval, expandedChunks, expandedSessions, rawSessions);
    }

    return visibleContext;
  }

  private formatSummariesOnly(retrieval: ProgressiveRetrievalResult): string {
    const parts = ['== Broad Summaries (retrieved by relevance) =='];
    for (const item of retrieval.broadSummaries) {
      const source = item.sourceWorkspace || 'global';
      if (item.type === 'chunk') {
        parts.push(
          `- [chunk_id=${item.id}] source=${source} session=${item.sessionId} title=${item.sourceSessionTitle || 'untitled'}: ${item.summary}`
        );
      } else {
        parts.push(
          `- [session_id=${item.sessionId}] source=${source} title=${item.sourceSessionTitle || 'untitled'}: ${item.summary}`
        );
      }
    }
    return parts.join('\n');
  }

  private formatFullContext(
    retrieval: ProgressiveRetrievalResult,
    expandedChunks: Map<string, ExpandedChunkData>,
    expandedSessions: Map<string, ExpandedSessionData>,
    rawSessions: Map<string, string>
  ): string {
    const parts: string[] = [];
    parts.push('== Broad Summaries ==');
    for (const item of retrieval.broadSummaries) {
      const source = item.sourceWorkspace || 'global';
      const expandedMarker =
        (item.type === 'chunk' && expandedChunks.has(item.id)) ||
        (item.type === 'session' && expandedSessions.has(item.sessionId))
          ? ' [EXPANDED below]'
          : '';
      if (item.type === 'chunk') {
        parts.push(
          `- [chunk_id=${item.id}] source=${source} session=${item.sessionId} title=${item.sourceSessionTitle || 'untitled'}: ${item.summary}${expandedMarker}`
        );
      } else {
        parts.push(
          `- [session_id=${item.sessionId}] source=${source} title=${item.sourceSessionTitle || 'untitled'}: ${item.summary}${expandedMarker}`
        );
      }
    }

    if (expandedChunks.size) {
      parts.push('\n== Expanded Chunk Raw Text ==');
      for (const [chunkId, value] of expandedChunks.entries()) {
        parts.push(
          `[chunk_id=${chunkId} | session=${value.sessionId} | source=${value.sourceWorkspace || 'global'}]\n  Keywords: ${value.keywords.join(
            ', '
          )}\n  Raw text:\n${value.rawText}`
        );
      }
    }

    if (expandedSessions.size) {
      parts.push('\n== Expanded Session Overview ==');
      for (const [sessionId, value] of expandedSessions.entries()) {
        parts.push(
          `[session_id=${sessionId} | source=${value.sourceWorkspace || 'global'} | date=${value.sessionDate} | title=${value.sourceSessionTitle || 'untitled'}]\n  Summary: ${value.summary}\n  Keywords: ${value.keywords.join(
            ', '
          )}\n  Chunks:`
        );
        for (const chunk of value.chunks) {
          parts.push(`    - [chunk_id=${chunk.chunkId}] ${chunk.summary} (keywords: ${chunk.keywords.join(', ')})`);
        }
      }
    }

    if (rawSessions.size) {
      parts.push('\n== Raw Session Transcripts ==');
      for (const value of rawSessions.values()) {
        parts.push(value);
      }
    }

    return parts.join('\n');
  }

  private async embedText(text: string): Promise<number[]> {
    if (!this.getAppConfig().memoryRuntime.useEmbedding || !text.trim()) {
      return [];
    }
    try {
      return await this.llmClient.embed(text);
    } catch (error) {
      logWarn('[MemoryService] Embedding failed, falling back to lexical retrieval:', error);
      return [];
    }
  }

  private extractRawText(turns: MemoryTranscriptTurn[], sourceTurns: number[]): string {
    return [...sourceTurns]
      .sort((a, b) => a - b)
      .map((turnNumber) => turns[turnNumber - 1])
      .filter((turn): turn is MemoryTranscriptTurn => Boolean(turn))
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');
  }

  private resolveSessionDate(
    session: MemoryIngestionInput['session'],
    messages: MemoryIngestionInput['messages']
  ): string {
    const timestamp = messages[messages.length - 1]?.timestamp || session.updatedAt || session.createdAt;
    return formatTimestamp(timestamp);
  }

  private resolveWorkspaceLabel(sourceWorkspace: string | null): string | undefined {
    if (!sourceWorkspace) {
      return undefined;
    }
    const basename = path.basename(sourceWorkspace);
    return basename || sourceWorkspace;
  }

  private sessionRowToSession(row: SessionRow): MemoryIngestionInput['session'] {
    return {
      id: row.id,
      title: row.title,
      status: row.status as MemoryIngestionInput['session']['status'],
      cwd: row.cwd || undefined,
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: row.memory_enabled === 1,
      model: row.model || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      claudeSessionId: row.claude_session_id || undefined,
      openaiThreadId: row.openai_thread_id || undefined,
    };
  }

  private getMessagesForSession(sessionId: string): MemoryIngestionInput['messages'] {
    return this.db.messages.getBySessionId(sessionId).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MemoryIngestionInput['messages'][number]['role'],
      content: this.safeParseContent(row.content),
      timestamp: row.timestamp,
      executionTimeMs: row.execution_time_ms || undefined,
    }));
  }

  private getSessionTitle(sessionId: string): string | undefined {
    return this.db.sessions.get(sessionId)?.title || undefined;
  }

  private safeParseContent(raw: string) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [{ type: 'text', text: String(parsed) }];
    } catch {
      return [{ type: 'text', text: raw }];
    }
  }

  private getAppConfig(): AppConfig {
    return configStore.getAll();
  }

  private getPaths(): MemoryPaths {
    const configuredRoot = this.getAppConfig().memoryRuntime.storageRoot?.trim();
    const configuredArtifactsRoot = this.getAppConfig().memoryRuntime.evalArtifactsRoot?.trim();
    const storageRoot = path.resolve(configuredRoot || path.join(app.getPath('userData'), 'memory'));
    return {
      storageRoot,
      coreFilePath: path.join(storageRoot, 'core_memory.json'),
      experienceFilePath: path.join(storageRoot, 'experience_memory.json'),
      stateFilePath: path.join(storageRoot, 'session_state.json'),
      artifactsDir: path.resolve(configuredArtifactsRoot || path.join(storageRoot, 'eval-artifacts')),
    };
  }

  private ensureStores(): void {
    const paths = this.getPaths();
    if (this.currentStorageRoot === paths.storageRoot && this.coreStore && this.stateStore && this.experienceStore) {
      return;
    }
    fs.mkdirSync(paths.storageRoot, { recursive: true });
    fs.mkdirSync(paths.artifactsDir, { recursive: true });
    this.currentStorageRoot = paths.storageRoot;
    this.coreStore = new CoreMemoryStore(paths.coreFilePath);
    this.stateStore = new MemorySessionStateStore(paths.stateFilePath);
    this.experienceStore = new ExperienceMemoryStore(paths.experienceFilePath);
  }

  private resetStores(): void {
    this.currentStorageRoot = null;
    this.coreStore = null;
    this.stateStore = null;
    this.experienceStore = null;
  }

  private getCoreStore(): CoreMemoryStore {
    this.ensureStores();
    return this.coreStore!;
  }

  private getStateStore(): MemorySessionStateStore {
    this.ensureStores();
    return this.stateStore!;
  }

  private getExperienceStore(): ExperienceMemoryStore {
    this.ensureStores();
    return this.experienceStore!;
  }

  private resolveFileKind(filePath: string): MemoryDebugFileInfo['kind'] {
    const paths = this.getPaths();
    if (filePath === paths.coreFilePath) {
      return 'core';
    }
    if (filePath === paths.experienceFilePath) {
      return 'experience';
    }
    if (filePath === paths.stateFilePath) {
      return 'state';
    }
    return 'artifacts';
  }

  private resolveReadablePath(filePath: string): string {
    const paths = this.getPaths();
    const requestedPath = path.resolve(filePath);
    if (!fs.existsSync(requestedPath)) {
      throw new Error('Requested file does not exist');
    }

    const normalizedPath = fs.realpathSync(requestedPath);
    const allowedRoots = [paths.storageRoot, paths.artifactsDir]
      .map((root) => path.resolve(root))
      .filter((root, index, all) => all.indexOf(root) === index)
      .map((root) => (fs.existsSync(root) ? fs.realpathSync(root) : root));

    if (!allowedRoots.some((root) => isSubPath(normalizedPath, root))) {
      throw new Error('Requested file is outside the memory storage root');
    }

    return normalizedPath;
  }
}
