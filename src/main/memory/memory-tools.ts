import { Type } from '@sinclair/typebox';
import type { MemoryService } from './memory-service';
import type { MemoryReadResult, MemorySearchResult, MemoryToolDefinition } from './memory-types';

function formatSearchResult(result: MemorySearchResult): string {
  const lines = [
    `- id: ${result.id}`,
    `  type: ${result.kind}`,
    `  title: ${result.title}`,
    `  summary: ${result.summary}`,
  ];
  if (result.workspaceKey) {
    lines.push(`  workspace: ${result.workspaceKey}`);
  }
  if (result.sessionTitle) {
    lines.push(`  session: ${result.sessionTitle}`);
  }
  if (result.sourceFile) {
    lines.push(`  file: ${result.sourceFile}`);
  }
  return lines.join('\n');
}

function formatReadResult(result: MemoryReadResult): string {
  const lines = [
    `id: ${result.id}`,
    `type: ${result.kind}`,
    `title: ${result.title}`,
    `summary: ${result.summary}`,
  ];
  if (result.workspaceKey) {
    lines.push(`workspace: ${result.workspaceKey}`);
  }
  if (result.sessionTitle) {
    lines.push(`session: ${result.sessionTitle}`);
  }
  if (result.sourceFile) {
    lines.push(`file: ${result.sourceFile}`);
  }
  if (result.details) {
    lines.push(`details:\n${result.details}`);
  }
  if (result.rawText) {
    lines.push(`raw_text:\n${result.rawText}`);
  }
  if (result.rawSession?.length) {
    lines.push(`raw_session_json:\n${JSON.stringify(result.rawSession, null, 2)}`);
  }
  if (result.sourceExcerpt) {
    lines.push(`source_excerpt:\n${result.sourceExcerpt}`);
  }
  return lines.join('\n\n');
}

export function createMemoryTools(memoryService: MemoryService): MemoryToolDefinition[] {
  const searchTool: MemoryToolDefinition = {
    name: 'memory_search',
    label: 'memory_search',
    description:
      'Search long-term memory across global core memory and unified experience memory with source provenance.',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: 'What you want to remember or look up.' }),
      scope: Type.Optional(
        Type.Union([
          Type.Literal('workspace'),
          Type.Literal('global'),
          Type.Literal('all'),
        ])
      ),
      workspace: Type.Optional(
        Type.String({
          description:
            'Absolute workspace path. Omit to use the current workspace when available.',
        })
      ),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    }),
    async execute(_toolCallId, params) {
      const result = memoryService.search({
        query: String((params as { query: string }).query || ''),
        cwd: typeof (params as { workspace?: string }).workspace === 'string'
          ? (params as { workspace?: string }).workspace
          : undefined,
        scope:
          typeof (params as { scope?: string }).scope === 'string'
            ? ((params as { scope?: 'workspace' | 'global' | 'all' }).scope as
                | 'workspace'
                | 'global'
                | 'all')
            : undefined,
        limit:
          typeof (params as { limit?: number }).limit === 'number'
            ? (params as { limit?: number }).limit
            : undefined,
      });

      const text =
        result.length > 0
          ? [`Found ${result.length} memory result(s):`, ...result.map(formatSearchResult)].join(
              '\n\n'
            )
          : 'No relevant memory found.';
      return {
        content: [{ type: 'text' as const, text }],
        details: undefined as unknown,
      };
    },
  };

  const readTool: MemoryToolDefinition = {
    name: 'memory_read',
    label: 'memory_read',
    description: 'Read a memory item returned by memory_search in full detail.',
    parameters: Type.Object({
      id: Type.String({ minLength: 1, description: 'The id returned by memory_search.' }),
    }),
    async execute(_toolCallId, params) {
      const result = memoryService.read(String((params as { id: string }).id || ''));
      const text = result ? formatReadResult(result) : 'Memory item not found.';
      return {
        content: [{ type: 'text' as const, text }],
        details: undefined as unknown,
      };
    },
  };

  return [searchTool, readTool];
}
