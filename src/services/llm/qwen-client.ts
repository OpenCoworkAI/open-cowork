import { logger } from '../../utils/logger';

export interface QwenClientConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | QwenContentItem[];
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

export interface QwenContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface QwenFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface QwenTool {
  type: 'function';
  function: QwenFunction;
}

export interface QwenChatCompletionRequest {
  model: string;
  messages: QwenMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  tools?: QwenTool[];
}

export interface QwenChatCompletionResponse {
  output: {
    text?: string;
    choices?: Array<{
      message: QwenMessage;
      finish_reason: string;
    }>;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  request_id: string;
}

export interface QwenStreamChunk {
  output: {
    text?: string;
    choices?: Array<{
      delta: Partial<QwenMessage>;
      finish_reason?: string;
    }>;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class QwenClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: QwenClientConfig) {
    if (!config.apiKey) {
      throw new Error('Qwen API key is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    this.defaultModel = config.model || 'qwen-turbo';
  }

  async chatCompletion(
    request: Omit<QwenChatCompletionRequest, 'model' | 'stream'> & {
      model?: string;
    }
  ): Promise<QwenChatCompletionResponse> {
    const url = `${this.baseUrl}/services/aigc/text-generation/generation`;
    
    const body: QwenChatCompletionRequest = {
      model: request.model || this.defaultModel,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      tools: request.tools,
      stream: false,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qwen API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as QwenChatCompletionResponse;
      return data;
    } catch (error) {
      logger.error('Qwen chat completion failed', { error });
      throw error;
    }
  }

  async *streamChatCompletion(
    request: Omit<QwenChatCompletionRequest, 'model' | 'stream'> & {
      model?: string;
    }
  ): AsyncGenerator<QwenStreamChunk, void, unknown> {
    const url = `${this.baseUrl}/services/aigc/text-generation/generation`;
    
    const body: QwenChatCompletionRequest = {
      model: request.model || this.defaultModel,
      messages: request.messages,
      temperature: request.temperature,
      top_p: request.top_p,
      max_tokens: request.max_tokens,
      tools: request.tools,
      stream: true,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Qwen API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;

          try {
            const chunk = JSON.parse(data) as QwenStreamChunk;
            yield chunk;
          } catch (parseError) {
            logger.warn('Failed to parse Qwen stream chunk', { data, error: parseError });
          }
        }
      }
    } catch (error) {
      logger.error('Qwen stream chat completion failed', { error });
      throw error;
    }
  }

  async multimodalChat(
    messages: QwenMessage[],
    options?: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
    }
  ): Promise<QwenChatCompletionResponse> {
    const model = options?.model || 'qwen-vl-plus';
    return this.chatCompletion({
      model,
      messages,
      ...options,
    });
  }

  async functionCall(
    messages: QwenMessage[],
    functions: QwenFunction[],
    options?: {
      model?: string;
      temperature?: number;
    }
  ): Promise<QwenChatCompletionResponse> {
    const tools: QwenTool[] = functions.map(fn => ({
      type: 'function',
      function: fn,
    }));

    return this.chatCompletion({
      model: options?.model || this.defaultModel,
      messages,
      tools,
      temperature: options?.temperature,
    });
  }
}
