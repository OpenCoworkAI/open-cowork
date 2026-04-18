import { BaseAgent } from './base-agent';
import { AgentConfig, Message } from '../types';

export type LLMProvider = 'deepseek' | 'qwen';

interface ProviderConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

export interface SystemAgentConfig extends AgentConfig {
  provider: LLMProvider;
  providerConfig: ProviderConfig;
}

interface LLMClient {
  chat(messages: Message[]): Promise<string>;
  formatPrompt(template: string, variables: Record<string, string>): string;
}

class DeepSeekClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com';
    this.model = config.model || 'deepseek-chat';
    this.temperature = config.temperature ?? 0.7;
  }

  async chat(messages: Message[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  formatPrompt(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = variables[key];
      return value !== undefined ? `<${key}>${value}</${key}>` : '';
    });
  }
}

class QwenClient implements LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private temperature: number;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1';
    this.model = config.model || 'qwen-turbo';
    this.temperature = config.temperature ?? 0.7;
  }

  async chat(messages: Message[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/services/aigc/text-generation/generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: { messages },
        parameters: {
          temperature: this.temperature
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Qwen API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.output?.text || '';
  }

  formatPrompt(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '');
  }
}

export class SystemAgent extends BaseAgent {
  private client: LLMClient | null = null;
  private config: SystemAgentConfig;

  constructor(config: SystemAgentConfig) {
    super(config);
    this.config = config;
  }

  async initialize(): Promise<void> {
    switch (this.config.provider) {
      case 'deepseek':
        this.client = new DeepSeekClient(this.config.providerConfig);
        break;
      case 'qwen':
        this.client = new QwenClient(this.config.providerConfig);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  async execute(prompt: string, context?: Message[]): Promise<string> {
    if (!this.client) {
      await this.initialize();
    }

    if (!this.client) {
      throw new Error('Failed to initialize LLM client');
    }

    const messages: Message[] = context ? [...context] : [];
    messages.push({ role: 'user', content: prompt });

    try {
      return await this.client.chat(messages);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`SystemAgent execution failed: ${error.message}`);
      }
      throw new Error('SystemAgent execution failed: Unknown error');
    }
  }

  formatPrompt(template: string, variables: Record<string, string>): string {
    if (!this.client) {
      throw new Error('Agent not initialized');
    }
    return this.client.formatPrompt(template, variables);
  }

  getProvider(): LLMProvider {
    return this.config.provider;
  }
}