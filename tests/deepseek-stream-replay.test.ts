import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { streamOpenAICompletions } from '@mariozechner/pi-ai/openai-completions';
import { buildSyntheticPiModel } from '../src/main/agent/pi-model-resolution';

describe('DeepSeek reasoning streaming', () => {
  it('retains the reasoning signature when a thinking block ends before a tool call', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [delta, finish_reason] of [
        [{ reasoning_content: 'Plan a read' }, null],
        [
          {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'read', arguments: '{}' },
              },
            ],
          },
          null,
        ],
        [{}, 'tool_calls'],
      ]) {
        response.write(
          `data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
        );
      }
      response.end('data: [DONE]\n\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing listener');
      const resolvedModel = buildSyntheticPiModel(
        'deepseek-v4-flash',
        'deepseek',
        'openai',
        `http://127.0.0.1:${address.port}/v1`
      );
      const model = { ...resolvedModel, api: 'openai-completions' as const };
      const events = [];
      for await (const event of streamOpenAICompletions(
        model,
        { messages: [{ role: 'user', content: 'Read', timestamp: 1 }] },
        { apiKey: 'local-test' }
      )) {
        events.push(event);
      }
      expect(events.find((event) => event.type === 'thinking_end')).toMatchObject({
        content: 'Plan a read',
        contentSignature: 'reasoning_content',
      });
      expect(events.at(-1)?.type).toBe('done');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
