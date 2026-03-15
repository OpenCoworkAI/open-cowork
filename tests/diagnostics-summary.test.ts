import { describe, expect, it } from 'vitest';
import { homedir } from 'os';
import type { Message, Session, TraceStep } from '../src/renderer/types';
import {
  buildDiagnosticsSummary,
  redactFileSystemPath,
} from '../src/main/utils/diagnostics-summary';

describe('buildDiagnosticsSummary', () => {
  it('exports only metadata for messages and trace steps', () => {
    const session: Session = {
      id: 'session-1',
      title: 'Debug Session',
      status: 'error',
      cwd: '/tmp/project',
      mountedPaths: [],
      allowedTools: [],
      memoryEnabled: false,
      model: 'gpt-test',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_010_000,
    };

    const messages: Message[] = [
      {
        id: 'message-1',
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: 'my secret token is abc123' }],
        timestamp: 1_700_000_001_000,
      },
      {
        id: 'message-2',
        sessionId: session.id,
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tool-1',
            content: 'file contents: password=super-secret',
          },
        ],
        timestamp: 1_700_000_002_000,
      },
    ];

    const traceSteps: TraceStep[] = [
      {
        id: 'step-1',
        type: 'tool_result',
        status: 'error',
        toolName: 'read_file',
        toolOutput: 'AWS_SECRET_ACCESS_KEY=very-secret',
        timestamp: 1_700_000_003_000,
        isError: true,
        title: 'Read file failed',
      },
    ];

    const summary = buildDiagnosticsSummary({
      exportedAt: new Date('2026-03-13T00:00:00.000Z'),
      app: {
        version: '1.0.0',
        isPackaged: false,
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
        electronVersion: '31',
        chromeVersion: '126',
      },
      runtime: {
        currentWorkingDir: '/tmp/project',
        logsDirectory: '/tmp/logs',
        logFileCount: 1,
        totalLogSizeBytes: 120,
        devLogsEnabled: true,
      },
      config: {
        provider: 'openai',
        model: 'gpt-test',
        baseUrl: 'https://example.com/v1',
        customProtocol: null,
        sandboxEnabled: false,
        thinkingEnabled: false,
        apiKeyConfigured: true,
        claudeCodePathConfigured: false,
        defaultWorkdir: '/tmp/project',
        globalSkillsPathConfigured: false,
      },
      sandbox: {
        mode: 'native',
        initialized: false,
      },
      sessions: [session],
      logFiles: [
        {
          name: 'app.log',
          path: '/tmp/logs/app.log',
          size: 120,
          mtime: new Date('2026-03-12T00:00:00.000Z'),
        },
      ],
      deps: {
        getMessages: () => messages,
        getTraceSteps: () => traceSteps,
      },
    });

    expect(summary.sessions.items[0].lastUserMessageMeta).toEqual({
      timestamp: '2023-11-14T22:13:21.000Z',
      blockTypes: ['text'],
      textBlockCount: 1,
      imageBlockCount: 0,
      fileAttachmentCount: 0,
      toolUseCount: 0,
      toolResultCount: 0,
    });
    expect(JSON.stringify(summary)).not.toContain('abc123');
    expect(JSON.stringify(summary)).not.toContain('super-secret');
    expect(summary.runtime.currentWorkingDir).toBe('<tmp>/project');
    expect(summary.runtime.logsDirectory).toBe('<tmp>/logs');
    expect(summary.config.defaultWorkdir).toBe('<tmp>/project');
    expect(summary.sessions.items[0].cwd).toBe('<tmp>/project');
    expect(summary.recentErrorSteps[0].toolOutputLength).toBeGreaterThan(0);
    expect(summary.recentErrorSteps[0]).not.toHaveProperty('toolOutputPreview');
  });

  it('sorts recent error steps globally by timestamp', () => {
    const sessions: Session[] = [
      {
        id: 'session-1',
        title: 'Older Session',
        status: 'error',
        cwd: undefined,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        createdAt: 10,
        updatedAt: 100,
      },
      {
        id: 'session-2',
        title: 'Newer Session',
        status: 'error',
        cwd: undefined,
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        createdAt: 20,
        updatedAt: 200,
      },
    ];

    const stepsBySession: Record<string, TraceStep[]> = {
      'session-1': [
        {
          id: 'older',
          type: 'tool_result',
          status: 'error',
          title: 'older',
          timestamp: 1_000,
          isError: true,
        },
      ],
      'session-2': [
        {
          id: 'newer',
          type: 'tool_result',
          status: 'error',
          title: 'newer',
          timestamp: 2_000,
          isError: true,
        },
      ],
    };

    const summary = buildDiagnosticsSummary({
      app: {
        version: '1.0.0',
        isPackaged: false,
        platform: 'darwin',
        arch: 'arm64',
        nodeVersion: 'v20',
      },
      runtime: {
        currentWorkingDir: null,
        logsDirectory: '/tmp/logs',
        logFileCount: 0,
        totalLogSizeBytes: 0,
        devLogsEnabled: true,
      },
      config: {
        provider: 'openai',
        model: 'gpt-test',
        baseUrl: null,
        customProtocol: null,
        sandboxEnabled: false,
        thinkingEnabled: false,
        apiKeyConfigured: true,
        claudeCodePathConfigured: false,
        defaultWorkdir: null,
        globalSkillsPathConfigured: false,
      },
      sandbox: {
        mode: 'native',
        initialized: false,
      },
      sessions,
      logFiles: [],
      deps: {
        getMessages: () => [],
        getTraceSteps: (sessionId) => stepsBySession[sessionId] || [],
      },
    });

    expect(summary.recentErrorSteps.map((step) => step.id)).toEqual(['newer', 'older']);
  });

  it('redacts absolute paths while preserving a small tail for debugging', () => {
    expect(redactFileSystemPath('/tmp/project/logs')).toBe('<tmp>/project/logs');
    expect(redactFileSystemPath(`${homedir()}/work/app`)).toBe('<home>/work/app');
    expect(redactFileSystemPath('C:\\Users\\tester\\AppData\\Local')).toBe('<abs>/AppData/Local');
    expect(redactFileSystemPath('./relative/path')).toBe('./relative/path');
  });
});
