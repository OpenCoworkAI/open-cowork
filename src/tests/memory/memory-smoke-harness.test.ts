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

class SmokeMemoryLLM implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('Memory Profiler')) {
      return {
        text: JSON.stringify({
          actions: request.userPrompt.includes('中文')
            ? [
                {
                  op: 'upsert',
                  category: 'preferences',
                  key: 'response_language',
                  value: '中文',
                },
              ]
            : [],
        }),
      };
    }

    if (
      request.systemPrompt.includes('experience memory extraction system') ||
      request.systemPrompt.includes('memory extraction system')
    ) {
      const isWorkspaceA = request.userPrompt.includes('workspace A');
      return {
        text: JSON.stringify({
          session_summary: isWorkspaceA
            ? 'workspace A 的 gateway token rotation 经验'
            : 'workspace B 的其他经验',
          session_keywords: isWorkspaceA ? ['gateway', 'rotation'] : ['other'],
          chunks: [
            {
              summary: isWorkspaceA
                ? 'workspace A 中关于 gateway token rotation 的结论'
                : 'workspace B 中不相关的总结',
              details: isWorkspaceA
                ? '在 workspace A 中完成 gateway token rotation，并保留后续整理说明。'
                : '这条记录属于另一个 workspace。',
              keywords: isWorkspaceA ? ['gateway', 'rotation'] : ['other'],
              source_turns: [1, 2, 3, 4],
            },
          ],
        }),
      };
    }

    if (request.systemPrompt.includes('memory retrieval navigator')) {
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

  async embed(): Promise<number[]> {
    return [];
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

function makeMessages(
  sessionId: string,
  items: Array<{ role: 'user' | 'assistant'; text: string; timestamp: number }>
) {
  return items.map((item, index) => ({
    id: `${sessionId}-${index}`,
    sessionId,
    role: item.role,
    content: [{ type: 'text' as const, text: item.text }],
    timestamp: item.timestamp,
  }));
}

describe('memory smoke harness', () => {
  let rawDb: Database.Database;
  let service: MemoryService;
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-memory-smoke-'));
    rawDb = new Database(':memory:');
    createSchema(rawDb);
    service = new MemoryService(createDatabaseInstance(rawDb), {
      llmClient: new SmokeMemoryLLM(),
    });
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

  it('simulates multi-session recall across same and different workspaces', async () => {
    const workspaceA = '/repo/workspace-a';
    const workspaceB = '/repo/workspace-b';

    await service.enqueueIngestion({
      session: {
        id: 'a-1',
        title: 'Gateway implementation',
        status: 'idle',
        cwd: workspaceA,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
      prompt: '实现 gateway token rotation',
      messages: makeMessages('a-1', [
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

    await service.enqueueIngestion({
      session: {
        id: 'b-1',
        title: 'Other workspace',
        status: 'idle',
        cwd: workspaceB,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: true,
        createdAt: 2000,
        updatedAt: 2000,
      },
      prompt: '记录别的事情',
      messages: makeMessages('b-1', [
        { role: 'user', text: '在 workspace B 中讨论不相关的话题。', timestamp: 5 },
        { role: 'assistant', text: '已记录。', timestamp: 6 },
      ]),
    });

    const sameWorkspacePrompt = await service.buildPromptPrefix(
      { cwd: workspaceA },
      '继续 gateway token rotation'
    );
    const otherWorkspacePrompt = await service.buildPromptPrefix(
      { cwd: workspaceB },
      '继续 gateway token rotation'
    );

    expect(sameWorkspacePrompt).toContain('gateway token rotation');
    expect(sameWorkspacePrompt).toContain('<experience_memory');
    expect(otherWorkspacePrompt).toContain('workspace A');
    expect(otherWorkspacePrompt).toContain('source=/repo/workspace-a');
    expect(otherWorkspacePrompt).toContain('<core_memory>');
  });

  it('keeps the manual live checklist alongside deterministic smoke coverage', async () => {
    const checklist = fs.readFileSync(
      path.resolve(process.cwd(), 'docs/memory-live-smoke-checklist.md'),
      'utf8'
    );
    expect(checklist).toContain('Cross-Workspace Recall');
    expect(checklist).toContain('Source Provenance');
    expect(checklist).toContain('Non-Interactive Flows');
  });
});
