import { Provider, Message, RequestOptions } from '../../types';

export class AlibabaProvider implements Provider {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL: string = 'https://dashscope.aliyuncs.com') {
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  private getEndpoint(model: string): string {
    if (model.includes('coding') || model.includes('code')) {
      return '/api/v1/services/aigc/text-generation/generation';
    }
    return '/compatible-mode/v1/chat/completions';
  }

  private getHeaders(model: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (model.includes('coding') || model.includes('code')) {
      headers['X-DashScope-Code'] = 'true';
    }

    return headers;
  }

  async chat(messages: Message[], options?: RequestOptions): Promise<any> {
    const model = options?.model || 'qwen-turbo';
    const endpoint = this.getEndpoint(model);
    const url = `${this.baseURL}${endpoint}`;
    const headers = this.getHeaders(model);

    const body = {
      model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: false,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Alibaba API request failed:', { url, status: response.status, model });
        throw new Error(`Alibaba API error: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Request URL:', url);
      throw error;
    }
  }

  async streamChat(messages: Message[], options?: RequestOptions): Promise<ReadableStream> {
    const model = options?.model || 'qwen-turbo';
    const endpoint = this.getEndpoint(model);
    const url = `${this.baseURL}${endpoint}`;
    const headers = this.getHeaders(model);

    const body = {
      model,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      stream: true,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Alibaba API request failed:', { url, status: response.status, model });
        throw new Error(`Alibaba API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      return response.body;
    } catch (error) {
      console.error('Request URL:', url);
      throw error;
    }
  }
}