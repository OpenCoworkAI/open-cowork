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
      evalEnabled: true,
      evalWorkspaces: [],
      evalMaxRounds: 6,
      evalArtifactsRoot: '',
      promptIterationRounds: 2,
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

vi.mock('../src/main/config/config-store', () => {
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
import type { DatabaseInstance } from '../src/main/db/database';
import { MemoryEvalHarness } from '../src/main/memory/memory-eval-harness';
import type { MemoryCompletionRequest, MemoryLLMClientLike } from '../src/main/memory/memory-llm-client';
import { MemoryPromptOptimizer } from '../src/main/memory/memory-prompt-optimizer';
import { MemoryService } from '../src/main/memory/memory-service';
import { configStore } from '../src/main/config/config-store';

class EvalMockLLM implements MemoryLLMClientLike {
  async complete(request: MemoryCompletionRequest): Promise<{ text: string }> {
    if (request.systemPrompt.includes('background Memory Profiler')) {
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

    if (request.systemPrompt.includes('experience memory extraction system') || request.systemPrompt.includes('Given a full user-assistant session')) {
      const transcript = request.userPrompt;
      if (transcript.includes('gateway token rotation')) {
        return {
          text: JSON.stringify({
            session_summary: '记录 gateway token rotation 与 remote gateway 约束',
            session_keywords: ['gateway', 'rotation'],
            chunks: [
              {
                summary: 'gateway token rotation 的实现与约束',
                details: '需要同时同步 remote gateway，避免状态不一致。',
                keywords: ['gateway', 'remote gateway'],
                source_turns: [1, 2, 3, 4],
              },
            ],
          }),
        };
      }
      return {
        text: JSON.stringify({
          session_summary: '记录订单状态机设计约束',
          session_keywords: ['refund', 'cancel'],
          chunks: [
            {
              summary: 'refunded 和 cancelled 不能合并',
              details: '两者代表不同财务语义。',
              keywords: ['refunded', 'cancelled', '财务语义'],
              source_turns: [1, 2],
            },
          ],
        }),
      };
    }

    if (request.systemPrompt.includes('memory retrieval navigator')) {
      return {
        text: JSON.stringify({
          sufficient: true,
          reason: 'enough',
          actions: [],
        }),
      };
    }

    if (request.systemPrompt.includes('strict memory retrieval evaluator')) {
      return {
        text: JSON.stringify({
          score: request.userPrompt.includes('gateway token rotation') ? 0.9 : 0.8,
          reason: 'good',
        }),
      };
    }

    if (request.systemPrompt.includes('optimizing prompts for a memory system')) {
      return {
        text: JSON.stringify({
          candidates: [
            {
              coreMemoryUpdateSystemPrompt: 'candidate core prompt',
              sessionChunkExtractionPrompt: 'candidate chunk prompt',
              memoryNavigationPrompt: 'candidate nav prompt',
            },
          ],
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
      get: vi.fn((id: string) => db.prepare('SELECT * FROM sessions WHERE id = ? LIMIT 1').get(id)),
      getAll: vi.fn(() => db.prepare('SELECT * FROM sessions ORDER BY created_at ASC').all() as any[]),
      delete: vi.fn(),
    },
    messages: {
      create: vi.fn(),
      update: vi.fn(),
      getBySessionId: vi.fn((sessionId: string) =>
        db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId) as any[]
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

describe('MemoryEvalHarness and MemoryPromptOptimizer', () => {
  let rawDb: Database.Database;
  let service: MemoryService;
  let tempRoot: string;
  const llm = new EvalMockLLM();

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-cowork-memory-eval-'));
    rawDb = new Database(':memory:');
    createSchema(rawDb);
    service = new MemoryService(createDatabaseInstance(rawDb), { llmClient: llm });
    configStore.update({
      memoryEnabled: true,
      memoryRuntime: {
        ...mockConfigState.config.memoryRuntime,
        storageRoot: path.join(tempRoot, 'memory-root'),
        evalArtifactsRoot: path.join(tempRoot, 'artifacts'),
      },
    });
  });

  afterEach(() => {
    rawDb.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('runs a multi-workspace eval harness and writes artifacts', async () => {
    const harness = new MemoryEvalHarness(service, llm);
    const artifactDir = path.join(tempRoot, 'artifacts', 'run-1');
    const report = await harness.run({ artifactDir });

    expect(report.caseResults.length).toBeGreaterThan(1);
    expect(report.averageScore).toBeGreaterThan(0.5);
    expect(fs.existsSync(path.join(artifactDir, 'report.json'))).toBe(true);
  });

  it('iterates prompt candidates and keeps the best score', async () => {
    const optimizer = new MemoryPromptOptimizer(llm);
    const baselineReport = {
      runId: 'baseline',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      averageScore: 0.5,
      caseResults: [],
      artifactDir: tempRoot,
    };

    const result = await optimizer.optimize({
      baselineReport,
      rounds: 1,
      evaluate: async (prompts) => ({
        ...baselineReport,
        averageScore: prompts.coreMemoryUpdateSystemPrompt === 'candidate core prompt' ? 0.8 : 0.4,
      }),
    });

    expect(result.bestScore).toBe(0.8);
    expect(result.prompts.coreMemoryUpdateSystemPrompt).toBe('candidate core prompt');
    expect(result.iterations[0]?.accepted).toBe(true);
  });
});
