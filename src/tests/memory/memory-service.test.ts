import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockConfigState = vi.hoisted(() => ({
  config: {
    provider: 'openrouter',
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    customProtocol: 'anthropic',
    model: 'anthropic/claude-sonnet-4-6',
    activeProfileKey: 'openrouter',
    profiles: {},
    activeConfigSetId: 'default',
    configSets: [],
    claudeCodePath: '',
    defaultWorkdir: '',
    globalSkillsPath: '',
    enableDevLogs: false,
    theme: 'light',
    sandboxEnabled: false,
    memoryEnabled: true,
    memoryRuntime: {
      llm: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: '',
        timeoutMs: 180000,
      },
      embedding: {
        inheritFromActive: true,
        apiKey: '',
        baseUrl: '',
        model: 'text-embedding-3-small',
        timeoutMs: 180000,
      },
      useEmbedding: false,
      maxNavSteps: 2,
      ingestionConcurrency: 2,
      storageRoot: '',
    },
    enableThinking: false,
    isConfigured: true,
  } as Record<string, unknown>,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp',
    getVersion: () => '0.0.0-test',
    getAppPath: () => '/tmp/open-cowork-test-app',
  },
}));

vi.mock('../../main/config/config-store', () => {
  const configStore = {
    getAll: () => ({ ...mockConfigState.config }),
    get: (key: string) => mockConfigState.config[key],
    update: (updates: Record<string, unknown>) => {
      mockConfigState.config = { ...mockConfigState.config, ...updates };
    },
    set: (key: string, value: unknown) => {
      mockConfigState.config = { ...mockConfigState.config, [key]: value };
    },
  };
  return {
    configStore,
    PROVIDER_PRESETS: {},
  };
});

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseInstance, MessageRow, SessionRow } from '../../main/db/database';
import type { MemoryCompletionRequest, MemoryLLMClientLike } from '../../main/memory/memory-llm-client';
import { MemoryService } from '../../main/memory/memory-service';
import { configStore } from '../../main/config/config-store';

class MockMemoryLLMClient implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('Memory Profiler')) {
      const actions = [];
      if (request.userPrompt.includes('Jack')) {
        actions.push({
          op: 'upsert',
          category: 'identity',
          key: 'name',
          value: 'Jack',
        });
      }
      if (request.userPrompt.includes('中文')) {
        actions.push({
          op: 'upsert',
          category: 'preferences',
          key: 'response_language',
          value: '中文',
        });
      }
      return { text: JSON.stringify({ actions }) };
    }

    if (
      request.systemPrompt.includes('experience memory extraction system') ||
      request.systemPrompt.includes('memory extraction system')
    ) {
      const transcript = request.userPrompt;
      if (transcript.includes('gateway token rotation')) {
        return {
          text: JSON.stringify({
            session_summary: '在当前 workspace 中实现并整理 gateway token rotation 相关改动',
            session_keywords: ['gateway', 'token', 'rotation'],
            chunks: [
              {
                summary: '实现 gateway token rotation 的主要改动',
                details: '记录了 gateway token rotation 的实现细节，并同步 remote gateway 行为。',
                keywords: ['gateway', 'rotation', 'remote'],
                source_turns: [1, 2, 3, 4],
              },
            ],
          }),
        };
      }

      return {
        text: JSON.stringify({
          session_summary: '记录用户稳定偏好',
          session_keywords: ['preference'],
          chunks: [
            {
              summary: '用户声明希望用中文回答',
              details: '对话中明确要求默认使用中文交流。',
              keywords: ['中文', '偏好'],
              source_turns: [1, 2],
            },
          ],
        }),
      };
    }

    if (request.systemPrompt.includes('memory retrieval navigator')) {
      const chunkMatch = request.userPrompt.match(/\[chunk_id=([^\]]+)\]/);
      if (
        request.userPrompt.includes('gateway token rotation') &&
        chunkMatch &&
        !request.userPrompt.includes('Expanded Chunk Details')
      ) {
        return {
          text: JSON.stringify({
            sufficient: false,
            reason: 'need_chunk_details',
            actions: [{ type: 'expand_chunk', chunk_id: chunkMatch[1] }],
          }),
        };
      }
      return {
        text: JSON.stringify({
          sufficient: true,
          reason: 'summaries_are_enough',
          actions: [],
        }),
      };
    }

    return { text: '{}' };
  }

  async embed(text: string): Promise<number[]> {
    return [text.includes('gateway') ? 1 : 0, text.includes('中文') ? 1 : 0];
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      claude_session_id TEXT,
      openai_thread_id TEXT,
      status TEXT NOT NULL,
      cwd TEXT,
      mounted_paths TEXT NOT NULL DEFAULT '[]',
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      token_usage TEXT,
      execution_time_ms INTEGER
    );
  `);
}

function createDatabaseInstance(db: Database.Database): DatabaseInstance {
  return {
    raw: db,
    sessions: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(
        (id: string) =>
          db.prepare('SELECT * FROM sessions WHERE id = ? LIMIT 1').get(id) as SessionRow | undefined
      ),
      getAll: vi.fn(
        () =>
          db.prepare('SELECT * FROM sessions ORDER BY created_at ASC').all() as SessionRow[]
      ),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(
        (sessionId: string) =>
          db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(
            sessionId
          ) as MessageRow[]
      ),
      delete: vi.fn(),
      deleteBySessionId: vi.fn(),
    },
    traceSteps: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn(() => []),
      deleteBySessionId: vi.fn(),
    },
    scheduledTasks: {
      create: vi.fn(),
      update: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(() => []),
      delete: vi.fn(),
    },
    prepare: (sql: string) => db.prepare(sql),
    exec: (sql: string) => db.exec(sql),
    pragma: (pragma: string) => db.pragma(pragma),
    close: () => db.close(),
  };
}

function insertSession(
  db: Database.Database,
  payload: { id: string; title: string; cwd?: string; memoryEnabled?: boolean; createdAt?: number }
): void {
  db.prepare(
    `
      INSERT INTO sessions (
        id, title, claude_session_id, openai_thread_id, status, cwd, mounted_paths, allowed_tools,
        memory_enabled, model, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, 'idle', ?, '[]', '[]', ?, NULL, ?, ?)
    `
  ).run(
    payload.id,
    payload.title,
    payload.cwd || null,
    payload.memoryEnabled === false ? 0 : 1,
    payload.createdAt || 1000,
    payload.createdAt || 1000
  );
}

function insertMessage(
  db: Database.Database,
  payload: { id: string; sessionId: string; role: 'user' | 'assistant'; text: string; timestamp: number }
): void {
  db.prepare(
    `
      INSERT INTO messages (id, session_id, role, content, timestamp, token_usage, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `
  ).run(
    payload.id,
    payload.sessionId,
    payload.role,
    JSON.stringify([{ type: 'text', text: payload.text }]),
    payload.timestamp
  );
}

function makeSession(id: string, title: string, cwd?: string) {
  return {
    id,
    title,
    status: 'idle' as const,
    cwd,
    mountedPaths: [],
    allowedTools: [],
    memoryEnabled: true,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeMessages(
  sessionId: string,
  items: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>
) {
  return items.map((item, index) => ({
    id: `${sessionId}-m-${index}`,
    sessionId,
    role: item.role,
    content: [{ type: 'text' as const, text: item.text }],
    timestamp: item.timestamp,
  }));
}

describe('MemoryService', () => {
  let rawDb: Database.Database;
  let db: DatabaseInstance;
  let service: MemoryService;
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-memory-'));
    rawDb = new Database(':memory:');
    createSchema(rawDb);
    db = createDatabaseInstance(rawDb);
    service = new MemoryService(db, { llmClient: new MockMemoryLLMClient() });
    configStore.update({
      memoryEnabled: true,
      memoryRuntime: {
        llm: {
          inheritFromActive: true,
          apiKey: '',
          baseUrl: '',
          model: '',
          timeoutMs: 180000,
        },
        embedding: {
          inheritFromActive: true,
          apiKey: '',
          baseUrl: '',
          model: 'text-embedding-3-small',
          timeoutMs: 180000,
        },
        useEmbedding: false,
        maxNavSteps: 2,
        ingestionConcurrency: 2,
        storageRoot: path.join(storageRoot, 'memory-root'),
      },
    });
  });

  afterEach(() => {
    rawDb.close();
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  it('writes core and unified experience memory into JSON files', async () => {
    const session = makeSession('session-a', 'Gateway fixes', '/repo/a');
    const messages = makeMessages('session-a', [
      { role: 'user', text: '请用中文回答，我叫 Jack。', timestamp: 1 },
      { role: 'assistant', text: '好的，我会用中文继续。', timestamp: 2 },
      {
        role: 'user',
        text: '我们修复 gateway token rotation，并更新 remote gateway 的行为。',
        timestamp: 3,
      },
      { role: 'assistant', text: '已经完成 gateway token rotation。', timestamp: 4 },
    ]);

    await service.enqueueIngestion({
      session,
      prompt: '修复 gateway token rotation',
      messages,
    });

    const overview = service.getOverview('/repo/a');
    expect(overview.coreCount).toBe(2);
    expect(overview.experienceSessionCount).toBe(1);
    expect(overview.experienceChunkCount).toBe(1);

    const core = service.readFile(overview.coreFilePath);
    expect(core.text).toContain('identity.name');
    expect(core.text).toContain('preferences.response_language');

    const files = service.listFiles();
    const experienceFile = files.find((item) => item.kind === 'experience');
    expect(experienceFile?.filePath).toContain('experience_memory.json');

    const experience = service.readFile(experienceFile!.filePath);
    expect(JSON.stringify(experience.parsed)).toContain('gateway token rotation');
    expect(JSON.stringify(experience.parsed)).toContain('remote gateway');
  });

  it('builds progressive prompt context and supports search/read/debug inspection', async () => {
    await service.enqueueIngestion({
      session: makeSession('session-a', 'Gateway fixes', '/repo/a'),
      prompt: '修复 gateway token rotation',
      messages: makeMessages('session-a', [
        { role: 'user', text: '请用中文回答。', timestamp: 1 },
        { role: 'assistant', text: '好的。', timestamp: 2 },
        {
          role: 'user',
          text: '在 workspace A 里实现 gateway token rotation，并同步 remote gateway。',
          timestamp: 3,
        },
        {
          role: 'assistant',
          text: '已在 workspace A 完成 gateway token rotation。',
          timestamp: 4,
        },
      ]),
    });

    const promptPrefix = await service.buildPromptPrefix(
      { cwd: '/repo/a' },
      '继续 gateway token rotation'
    );
    expect(promptPrefix).toContain('<core_memory>');
    expect(promptPrefix).toContain('<experience_memory');
    expect(promptPrefix).toContain('Expanded Chunk Raw Text');
    expect(promptPrefix).toContain('gateway token rotation');

    const results = service.search({
      query: 'gateway token rotation',
      cwd: '/repo/a',
      scope: 'workspace',
      limit: 10,
    });
    expect(results.some((item) => item.kind === 'experience_chunk')).toBe(true);

    const detail = service.read(results[0].id);
    expect(detail?.sourceFile).toContain('experience_memory.json');
    expect(detail?.summary || detail?.rawText).toContain('gateway token rotation');

    const inspected = service.inspectSession('session-a', '/repo/a');
    expect(inspected?.session.sessionId).toBe('session-a');
    expect(inspected?.chunks).toHaveLength(1);
    expect(inspected?.sourceWorkspace).toBe('/repo/a');
  });

  it('rebuilds all memory from persisted sessions and messages', async () => {
    insertSession(rawDb, {
      id: 'session-a',
      title: 'Gateway fixes',
      cwd: '/repo/a',
      createdAt: 1000,
    });
    insertMessage(rawDb, {
      id: 'm1',
      sessionId: 'session-a',
      role: 'user',
      text: '请用中文回答，我叫 Jack。',
      timestamp: 1,
    });
    insertMessage(rawDb, {
      id: 'm2',
      sessionId: 'session-a',
      role: 'assistant',
      text: '好的。',
      timestamp: 2,
    });
    insertMessage(rawDb, {
      id: 'm3',
      sessionId: 'session-a',
      role: 'user',
      text: '继续处理 gateway token rotation。',
      timestamp: 3,
    });

    const result = await service.rebuildAll();
    expect(result.success).toBe(true);
    expect(result.sessionCount).toBe(1);

    const overview = service.getOverview('/repo/a');
    expect(overview.coreCount).toBeGreaterThan(0);
    expect(overview.experienceSessionCount).toBe(1);
    expect(overview.sourceWorkspaceCount).toBe(1);
    expect(overview.experienceFilePath).toContain('experience_memory.json');
  });

  it('does not resurrect deleted experience memory when deletion happens during queued ingestion', async () => {
    const sessionId = 'session-race';
    const session = makeSession(sessionId, 'Gateway fixes', '/repo/a');
    const messages = makeMessages(sessionId, [
      { role: 'user', text: '请用中文回答。', timestamp: 1 },
      { role: 'assistant', text: '好的。', timestamp: 2 },
      {
        role: 'user',
        text: '继续处理 gateway token rotation，并记录 remote gateway 约束。',
        timestamp: 3,
      },
      { role: 'assistant', text: '已经完成 gateway token rotation。', timestamp: 4 },
    ]);

    insertSession(rawDb, {
      id: sessionId,
      title: session.title,
      cwd: session.cwd,
      createdAt: session.createdAt,
    });

    let releaseExtraction!: () => void;
    const blockedLlm: MemoryLLMClientLike = {
      ...new MockMemoryLLMClient(),
      async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
        if (request.systemPrompt.includes('memory extraction system')) {
          await new Promise<void>((resolve) => {
            releaseExtraction = resolve;
          });
        }
        return new MockMemoryLLMClient().complete(request);
      },
      async embed(text: string): Promise<number[]> {
        return new MockMemoryLLMClient().embed(text);
      },
    };

    service = new MemoryService(db, { llmClient: blockedLlm });
    const ingestionPromise = service.enqueueIngestion({
      session,
      prompt: '处理 gateway token rotation',
      messages,
    });

    await vi.waitFor(() => expect(typeof releaseExtraction).toBe('function'));
    rawDb.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    const deletionPromise = service.deleteSession(sessionId);

    releaseExtraction();
    await ingestionPromise;
    await deletionPromise;

    expect(service.inspectSession(sessionId, '/repo/a')).toBeNull();
    expect(service.search({ query: 'gateway token rotation', scope: 'all', limit: 10 })).toHaveLength(0);
  });

  it('rejects reading files that escape the memory root through symlinks', async () => {
    await service.enqueueIngestion({
      session: makeSession('session-a', 'Gateway fixes', '/repo/a'),
      prompt: '修复 gateway token rotation',
      messages: makeMessages('session-a', [
        { role: 'user', text: '请用中文回答。', timestamp: 1 },
        { role: 'assistant', text: '好的。', timestamp: 2 },
      ]),
    });

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-memory-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.json');
    fs.writeFileSync(outsideFile, '{"secret":true}', 'utf8');

    const symlinkPath = path.join(service.getOverview().storageRoot, 'escape-link.json');
    fs.symlinkSync(outsideFile, symlinkPath);

    expect(() => service.readFile(symlinkPath)).toThrow('outside the memory storage root');

    fs.rmSync(outsideDir, { recursive: true, force: true });
    fs.rmSync(symlinkPath, { force: true });
  });
});
