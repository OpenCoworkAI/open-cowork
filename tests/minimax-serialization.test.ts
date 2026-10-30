import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamSimple, type Context } from '@mariozechner/pi-ai';
import {
  buildSyntheticPiModel,
  applyPiModelRuntimeOverrides,
} from '../src/main/agent/pi-model-resolution';
import { installMiniMaxPayloadHook } from '../src/main/agent/minimax-payload';

const context: Context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        { type: 'image', mimeType: 'image/png', data: 'AA==' },
      ],
      timestamp: 1,
    },
  ],
  tools: [
    {
      name: 'lookup',
      description: 'Look up a value',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      } as NonNullable<Context['tools']>[number]['parameters'],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('MiniMax outgoing SDK HTTP requests', () => {
  it.each([
    ['MiniMax-M3', 'https://api.minimax.io/v1'],
    ['MiniMax-M2.7', 'https://api.minimaxi.com/v1'],
    ['my-private-model', 'https://relay.example/v1'],
    ['MiniMax-M3.1-Flash', 'https://relay.example/v1'],
  ])('preserves explicit %s at %s', async (id, baseUrl) => {
    const model = buildSyntheticPiModel(id, 'openai', 'openai', baseUrl);
    const agent = { _onPayload: undefined };
    installMiniMaxPayloadHook(agent);
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(await new Request(input, init).text()));
        return new Response(JSON.stringify({ error: { message: 'offline fixture' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      })
    );
    await streamSimple(model, context, {
      apiKey: 'offline-fixture',
      onPayload: agent._onPayload,
    }).result();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe(id);
    expect(bodies[0].reasoning_effort).toBeUndefined();
  });
  for (const host of ['api.minimax.io', 'api.minimaxi.com']) {
    for (const protocol of ['anthropic', 'openai']) {
      it.each([undefined, 'low', 'medium', 'high'] as const)(
        `${host} ${protocol} thinking=%s`,
        async (reasoning) => {
          const baseUrl = `https://${host}/${protocol === 'openai' ? 'v1' : 'anthropic'}`;
          const model = applyPiModelRuntimeOverrides(
            buildSyntheticPiModel('MiniMax-M3.1-Flash', protocol, protocol, baseUrl),
            {
              configProvider: protocol,
              rawProvider: 'custom',
              customProtocol: protocol,
              customBaseUrl: baseUrl,
            }
          );
          const agent = { _onPayload: undefined };
          expect(installMiniMaxPayloadHook(agent)).toBe(true);
          const captures: Array<{ url: string; body: Record<string, unknown> }> = [];
          vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = new Request(input, init);
              captures.push({ url: request.url, body: JSON.parse(await request.text()) });
              // Stop after serialization; no provider or paid inference is contacted.
              return new Response(JSON.stringify({ error: { message: 'offline fixture' } }), {
                status: 400,
                headers: { 'content-type': 'application/json' },
              });
            })
          );
          await streamSimple(model, context, {
            apiKey: 'offline-fixture',
            reasoning,
            maxTokens: 1024,
            onPayload: agent._onPayload,
          }).result();
          expect(captures).toHaveLength(1);
          const { url, body } = captures[0];
          expect(url).toContain(host);
          expect(url).toContain(protocol === 'openai' ? '/chat/completions' : '/messages');
          expect(body.model).toBe('MiniMax-M3.1-Flash');
          expect(body.service_tier).toBeUndefined();
          expect(JSON.stringify(body.messages)).toContain('AA==');
          expect(JSON.stringify(body.tools)).toContain('lookup');
          if (protocol === 'anthropic') {
            expect(body.thinking).toEqual({ type: 'adaptive' });
            expect(body.output_config).toEqual({ effort: 'max' });
          } else {
            expect(body.reasoning_effort).toBe(reasoning || 'max');
            expect(body.reasoning_split).not.toBe(false);
          }
        }
      );
    }
  }
});
