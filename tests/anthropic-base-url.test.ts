import Anthropic from '@anthropic-ai/sdk';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';

describe('Anthropic-compatible base URLs', () => {
  it('appends the messages path after the configured base URL', async () => {
    let requestPath = '';
    const server = createServer((request, response) => {
      requestPath = request.url || '';
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'MiniMax-M3',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        })
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Expected a local TCP server address');
    }

    try {
      const client = new Anthropic({
        apiKey: 'placeholder',
        baseURL: `http://127.0.0.1:${address.port}/anthropic`,
      });
      await client.messages.create({
        model: 'MiniMax-M3',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(requestPath).toBe('/anthropic/v1/messages');
  });
});
