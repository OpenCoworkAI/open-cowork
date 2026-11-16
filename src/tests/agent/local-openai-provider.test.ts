import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { completeSimple, type Context } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { API_PROVIDER_PRESETS } from '../../shared/api-model-presets';
import { LOCAL_OPENAI_BASE_URLS } from '../../shared/local-openai-provider';
import { isOpenAIProvider, resolveOpenAICredentials } from '../../main/config/auth-utils';
import {
  applyPiModelRuntimeOverrides,
  buildSyntheticPiModel,
  resolvePiModelString,
  resolvePiRegistryModel,
  resolvePiRouteProtocol,
  resolveSyntheticPiModelFallback,
} from '../../main/agent/pi-model-resolution';

describe.each(['vllm', 'lmstudio'] as const)('%s local provider', (provider) => {
  it('keeps local authentication optional while honoring remote authentication', () => {
    const local = { provider, baseUrl: LOCAL_OPENAI_BASE_URLS[provider], apiKey: '' };
    expect(isOpenAIProvider(local)).toBe(true);
    expect(resolveOpenAICredentials(local)?.apiKey).toBeTruthy();
    expect(
      resolveOpenAICredentials({ ...local, baseUrl: 'https://models.example.test/v1' })
    ).toBeNull();
    expect(resolveOpenAICredentials({ ...local, apiKey: 'server-key' })?.apiKey).toBe('server-key');
    expect(API_PROVIDER_PRESETS[provider].baseUrl).toBe(LOCAL_OPENAI_BASE_URLS[provider]);
  });

  it('preserves served model identifiers with slashes and routes known models to the local endpoint', () => {
    const model = 'organization/served-model';
    const modelString = resolvePiModelString({ provider, model });
    expect(resolvePiRouteProtocol(provider, 'anthropic')).toBe('openai');
    expect(modelString).toBe(`openai/${model}`);
    expect(
      resolveSyntheticPiModelFallback({
        rawProvider: provider,
        rawModel: model,
        resolvedModelString: modelString,
        routeProtocol: 'openai',
      })
    ).toEqual({ provider: 'openai', modelId: model });
    const known = resolvePiRegistryModel('openai/gpt-5.4', {
      rawProvider: provider,
      customBaseUrl: LOCAL_OPENAI_BASE_URLS[provider],
    });
    expect(known).toMatchObject({
      api: 'openai-completions',
      provider: 'openai',
      baseUrl: LOCAL_OPENAI_BASE_URLS[provider],
    });
  });

  it('streams chat and completes a tool round trip against an OpenAI-compatible local server', async () => {
    const requests: Array<{ url: string; payload: Record<string, unknown> }> = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      requests.push({ url: req.url || '', payload: JSON.parse(body) as Record<string, unknown> });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const delta =
        requests.length === 1
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_local',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"example.txt"}' },
                },
              ],
            }
          : { role: 'assistant', content: 'Read the local file.' };
      const chunk = {
        id: 'chat-local',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'organization/served-model',
        choices: [{ index: 0, delta, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      res.end(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local server address');
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const model = applyPiModelRuntimeOverrides(
      buildSyntheticPiModel('organization/served-model', 'openai', 'openai', baseUrl),
      { rawProvider: provider, customBaseUrl: baseUrl }
    );
    const context: Context = {
      messages: [{ role: 'user', content: 'Read example.txt', timestamp: 1 }],
      tools: [
        {
          name: 'read_file',
          description: 'Read a local file',
          parameters: Type.Object({ path: Type.String() }),
        },
      ],
    };
    try {
      const first = await completeSimple(model, context, { apiKey: 'local-placeholder' });
      expect(first.stopReason).toBe('toolUse');
      expect(first.content).toContainEqual({
        type: 'toolCall',
        id: 'call_local',
        name: 'read_file',
        arguments: { path: 'example.txt' },
      });
      const second = await completeSimple(
        model,
        {
          ...context,
          messages: [
            ...context.messages,
            first,
            {
              role: 'toolResult',
              toolCallId: 'call_local',
              toolName: 'read_file',
              content: [{ type: 'text', text: 'Example contents' }],
              isError: false,
              timestamp: 2,
            },
          ],
        },
        { apiKey: 'local-placeholder' }
      );
      expect(second.stopReason).toBe('stop');
      expect(second.content).toContainEqual({ type: 'text', text: 'Read the local file.' });
      expect(requests).toHaveLength(2);
      expect(requests.every((request) => request.url === '/v1/chat/completions')).toBe(true);
      expect(requests[1]?.payload).toMatchObject({
        model: 'organization/served-model',
        messages: expect.arrayContaining([
          { role: 'tool', tool_call_id: 'call_local', content: 'Example contents' },
        ]),
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
