import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryService } from './memory-service';
import type { MemoryLLMClientLike } from './memory-llm-client';
import { MemoryLLMClient } from './memory-llm-client';
import { extractJson, loadJsonFile, normalizeWorkspaceKey, saveJsonFile } from './memory-utils';

export interface MemoryEvalMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface MemoryEvalQuery {
  id: string;
  prompt: string;
  workspace?: string;
  expectedHits: string[];
  forbiddenHits?: string[];
}

export interface MemoryEvalCase {
  id: string;
  title: string;
  workspace?: string;
  sessionTitle: string;
  messages: MemoryEvalMessage[];
  queries: MemoryEvalQuery[];
}

export interface MemoryEvalQueryResult {
  queryId: string;
  prompt: string;
  workspace?: string;
  promptPrefix: string;
  deterministicScore: number;
  judgeScore: number | null;
  finalScore: number;
  expectedHits: string[];
  forbiddenHits: string[];
  matchedExpectedHits: string[];
  matchedForbiddenHits: string[];
}

export interface MemoryEvalCaseResult {
  caseId: string;
  sessionId: string;
  title: string;
  workspace?: string;
  queryResults: MemoryEvalQueryResult[];
  averageScore: number;
}

export interface MemoryEvalReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  averageScore: number;
  caseResults: MemoryEvalCaseResult[];
  artifactDir: string;
}

const DEFAULT_EVAL_CASES: MemoryEvalCase[] = [
  {
    id: 'cross-workspace-code',
    title: '跨 workspace 代码经验召回',
    workspace: '/eval/workspace-a',
    sessionTitle: 'Gateway token rotation',
    messages: [
      { role: 'user', text: '请以后默认用中文回答。', timestamp: 1 },
      { role: 'assistant', text: '好的，我会默认使用中文。', timestamp: 2 },
      {
        role: 'user',
        text: '在 workspace A 中实现 gateway token rotation，并记录 remote gateway 的同步约束。',
        timestamp: 3,
      },
      {
        role: 'assistant',
        text: '已完成 gateway token rotation，并说明 remote gateway 需要同步更新。',
        timestamp: 4,
      },
    ],
    queries: [
      {
        id: 'query-a1',
        prompt: '继续 gateway token rotation，提醒我上次的关键约束。',
        workspace: '/eval/workspace-a',
        expectedHits: ['gateway token rotation', 'remote gateway', 'source=/eval/workspace-a'],
      },
      {
        id: 'query-a2',
        prompt: '我偏好什么回答风格？',
        expectedHits: ['中文'],
      },
    ],
  },
  {
    id: 'cross-workspace-design',
    title: '另一个 workspace 的设计决策',
    workspace: '/eval/workspace-b',
    sessionTitle: 'Order state machine',
    messages: [
      {
        role: 'user',
        text: '在 workspace B 中，我们决定订单状态机不要把 refunded 和 cancelled 合并。',
        timestamp: 10,
      },
      {
        role: 'assistant',
        text: '已记录：refunded 和 cancelled 代表不同的财务语义，需要保留独立状态。',
        timestamp: 11,
      },
    ],
    queries: [
      {
        id: 'query-b1',
        prompt: '为什么 refunded 和 cancelled 不能合并？',
        workspace: '/eval/workspace-b',
        expectedHits: ['refunded', 'cancelled', '财务语义'],
      },
    ],
  },
];

function createMessages(sessionId: string, messages: MemoryEvalMessage[]) {
  return messages.map((item, index) => ({
    id: `${sessionId}-${index}`,
    sessionId,
    role: item.role,
    content: [{ type: 'text' as const, text: item.text }],
    timestamp: item.timestamp,
  }));
}

function scorePromptPrefix(promptPrefix: string, expectedHits: string[], forbiddenHits: string[]): {
  deterministicScore: number;
  matchedExpectedHits: string[];
  matchedForbiddenHits: string[];
} {
  const normalized = promptPrefix.toLowerCase();
  const matchedExpectedHits = expectedHits.filter((item) => normalized.includes(item.toLowerCase()));
  const matchedForbiddenHits = forbiddenHits.filter((item) => normalized.includes(item.toLowerCase()));
  const expectedScore = expectedHits.length ? matchedExpectedHits.length / expectedHits.length : 1;
  const forbiddenPenalty = forbiddenHits.length ? matchedForbiddenHits.length / forbiddenHits.length : 0;
  return {
    deterministicScore: Math.max(0, expectedScore - forbiddenPenalty),
    matchedExpectedHits,
    matchedForbiddenHits,
  };
}

export class MemoryEvalHarness {
  constructor(
    private readonly service: MemoryService,
    private readonly llm: MemoryLLMClientLike = new MemoryLLMClient()
  ) {}

  async run(options?: {
    artifactDir: string;
    cases?: MemoryEvalCase[];
    useModelJudge?: boolean;
  }): Promise<MemoryEvalReport> {
    const cases = options?.cases || DEFAULT_EVAL_CASES;
    const runId = `memory-eval-${Date.now()}`;
    const artifactDir = path.resolve(options!.artifactDir);
    fs.mkdirSync(artifactDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const caseResults: MemoryEvalCaseResult[] = [];

    for (const testCase of cases) {
      const sessionId = `${testCase.id}-session`;
      await this.service.enqueueIngestion({
        session: {
          id: sessionId,
          title: testCase.sessionTitle,
          status: 'idle',
          cwd: testCase.workspace,
          mountedPaths: [],
          allowedTools: [],
          memoryEnabled: true,
          createdAt: testCase.messages[0]?.timestamp || Date.now(),
          updatedAt: testCase.messages[testCase.messages.length - 1]?.timestamp || Date.now(),
        },
        prompt: testCase.messages[0]?.text || testCase.title,
        messages: createMessages(sessionId, testCase.messages),
      });

      const queryResults: MemoryEvalQueryResult[] = [];
      for (const query of testCase.queries) {
        const promptPrefix = await this.service.buildPromptPrefix(
          { cwd: query.workspace || testCase.workspace },
          query.prompt
        );
        const scoring = scorePromptPrefix(promptPrefix, query.expectedHits, query.forbiddenHits || []);
        const judgeScore = options?.useModelJudge === false ? null : await this.judgeQuery(query.prompt, promptPrefix);
        const finalScore = judgeScore === null ? scoring.deterministicScore : (judgeScore + scoring.deterministicScore) / 2;
        const queryResult: MemoryEvalQueryResult = {
          queryId: query.id,
          prompt: query.prompt,
          workspace: normalizeWorkspaceKey(query.workspace || testCase.workspace || null) || undefined,
          promptPrefix,
          deterministicScore: scoring.deterministicScore,
          judgeScore,
          finalScore,
          expectedHits: query.expectedHits,
          forbiddenHits: query.forbiddenHits || [],
          matchedExpectedHits: scoring.matchedExpectedHits,
          matchedForbiddenHits: scoring.matchedForbiddenHits,
        };
        queryResults.push(queryResult);
      }

      const averageScore =
        queryResults.reduce((sum, item) => sum + item.finalScore, 0) / Math.max(queryResults.length, 1);
      const caseResult: MemoryEvalCaseResult = {
        caseId: testCase.id,
        sessionId,
        title: testCase.title,
        workspace: normalizeWorkspaceKey(testCase.workspace || null) || undefined,
        queryResults,
        averageScore,
      };
      caseResults.push(caseResult);
      saveJsonFile(path.join(artifactDir, `${testCase.id}.json`), caseResult);
    }

    const report: MemoryEvalReport = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      averageScore:
        caseResults.reduce((sum, item) => sum + item.averageScore, 0) / Math.max(caseResults.length, 1),
      caseResults,
      artifactDir,
    };
    saveJsonFile(path.join(artifactDir, 'report.json'), report);
    return loadJsonFile(path.join(artifactDir, 'report.json'), report);
  }

  private async judgeQuery(prompt: string, promptPrefix: string): Promise<number | null> {
    try {
      const response = await this.llm.complete({
        systemPrompt: [
          'You are a strict memory retrieval evaluator.',
          'Score whether the injected memory context is useful, specific, and not overly noisy for answering the user prompt.',
          'Return JSON only with shape {"score": number, "reason": string}.',
          'Score must be between 0 and 1.',
        ].join('\n'),
        userPrompt: [`User prompt: ${prompt}`, '', 'Injected memory context:', promptPrefix].join('\n'),
        temperature: 0,
        maxTokens: 800,
      });
      const parsed = extractJson(response.text);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const score = (parsed as { score?: unknown }).score;
      if (typeof score !== 'number' || !Number.isFinite(score)) {
        return null;
      }
      return Math.max(0, Math.min(1, score));
    } catch {
      return null;
    }
  }
}
