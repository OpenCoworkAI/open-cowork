/**
 * Computer Use Session - Manages the Anthropic Computer Use API loop
 *
 * When a VM is active with computer-use enabled, this session class handles
 * the tool execution loop: send message → get tool_use → execute → return result → repeat.
 * Uses @anthropic-ai/sdk directly for the computer_use_20250124 beta tool type.
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { log, logError } from '../utils/logger';
import type { ComputerUseAdapter, ComputerUseAction } from './computer-use-adapter';
import type { ServerEvent, Message } from '../../renderer/types';
import { v4 as uuidv4 } from 'uuid';

const MAX_TOOL_LOOPS = 25; // Safety limit for tool execution loops

interface ComputerUseSessionOptions {
  adapter: ComputerUseAdapter;
  apiKey: string;
  model?: string;
  sendToRenderer: (event: ServerEvent) => void;
  saveMessage?: (message: Message) => void;
  sessionId: string;
}

export class ComputerUseSession {
  private adapter: ComputerUseAdapter;
  private client: Anthropic;
  private model: string;
  private sendToRenderer: (event: ServerEvent) => void;
  private saveMessage?: (message: Message) => void;
  private sessionId: string;
  private aborted = false;

  constructor(options: ComputerUseSessionOptions) {
    this.adapter = options.adapter;
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || 'claude-sonnet-4-5-20250929';
    this.sendToRenderer = options.sendToRenderer;
    this.saveMessage = options.saveMessage;
    this.sessionId = options.sessionId;
  }

  /** Abort the current session loop */
  abort(): void {
    this.aborted = true;
  }

  /** Run a computer use session with the given prompt and system instructions */
  async run(
    prompt: string,
    systemPrompt: string,
    existingMessages?: Array<{ role: 'user' | 'assistant'; content: any }>,
  ): Promise<void> {
    this.aborted = false;
    const displaySize = this.adapter.getDisplaySize();

    // Build the tools array with computer_use tool
    const tools: any[] = [
      {
        type: 'computer_20250124',
        name: 'computer',
        display_width_px: displaySize.width,
        display_height_px: displaySize.height,
        display_number: 1,
      },
    ];

    // Build initial messages
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      ...(existingMessages || []),
      { role: 'user', content: prompt },
    ];

    // Tool execution loop
    let loopCount = 0;
    while (loopCount < MAX_TOOL_LOOPS && !this.aborted) {
      loopCount++;

      try {
        log('[ComputerUseSession] Loop', loopCount, '- sending request');

        // Take an initial screenshot so the model can see the current state
        if (loopCount === 1) {
          const screenshot = await this.adapter.execute({ action: 'screenshot' });
          if (screenshot.type === 'screenshot' && screenshot.base64Image) {
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshot.base64Image,
                  },
                },
              ],
            });
            // Replace the simple text message with the one including the screenshot
            messages.pop(); // remove the image+text we just pushed (wrong position)
            messages.pop(); // remove the original text prompt
            messages.push({
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshot.base64Image,
                  },
                },
              ],
            });
          }
        }

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
          betas: ['computer-use-2025-01-24'],
        } as any);

        // Process response blocks
        const assistantContent: any[] = [];
        const toolResults: any[] = [];

        for (const block of response.content) {
          assistantContent.push(block);

          if (block.type === 'text') {
            // Stream text to renderer
            this.sendToRenderer({
              type: 'stream.partial',
              payload: {
                sessionId: this.sessionId,
                delta: block.text,
              },
            });

            // Save assistant message
            if (this.saveMessage) {
              this.saveMessage({
                id: uuidv4(),
                sessionId: this.sessionId,
                role: 'assistant',
                content: [{ type: 'text', text: block.text }],
                timestamp: Date.now(),
              });
            }
          }

          if (block.type === 'tool_use') {
            // Emit trace step for the tool call
            const traceStepId = uuidv4();
            this.sendToRenderer({
              type: 'trace.step',
              payload: {
                sessionId: this.sessionId,
                step: {
                  id: traceStepId,
                  type: 'tool_call',
                  status: 'running',
                  title: `Computer Use: ${(block.input as any)?.action || 'unknown'}`,
                  toolName: 'computer',
                  toolInput: block.input as Record<string, unknown>,
                  timestamp: Date.now(),
                },
              },
            });

            // Execute the computer use action
            const action = block.input as ComputerUseAction;
            const result = await this.adapter.execute(action);

            // Build tool_result content
            const toolResultContent: any[] = [];
            if (result.type === 'screenshot' && result.base64Image) {
              toolResultContent.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: result.base64Image,
                },
              });
            } else if (result.type === 'error') {
              toolResultContent.push({
                type: 'text',
                text: `Error: ${result.error}`,
              });
            } else if (result.type === 'coordinate') {
              toolResultContent.push({
                type: 'text',
                text: `Cursor position: (${result.coordinate![0]}, ${result.coordinate![1]})`,
              });
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResultContent,
            });

            // Update trace step to completed
            this.sendToRenderer({
              type: 'trace.update',
              payload: {
                sessionId: this.sessionId,
                stepId: traceStepId,
                updates: {
                  status: 'completed',
                  toolOutput: result.type === 'error' ? result.error : `${result.type} result`,
                  duration: 0,
                },
              },
            });
          }
        }

        // Add assistant message to conversation
        messages.push({ role: 'assistant', content: assistantContent });

        // If there were tool calls, add tool results and continue the loop
        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
          continue;
        }

        // No tool calls — the model is done
        if (response.stop_reason === 'end_turn' || !toolResults.length) {
          log('[ComputerUseSession] Session complete after', loopCount, 'loops');

          // Emit session idle
          this.sendToRenderer({
            type: 'session.status',
            payload: { sessionId: this.sessionId, status: 'idle' },
          });
          break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logError('[ComputerUseSession] Error in loop', loopCount, ':', msg);

        this.sendToRenderer({
          type: 'session.status',
          payload: {
            sessionId: this.sessionId,
            status: 'error',
            error: msg,
          },
        });
        break;
      }
    }

    if (loopCount >= MAX_TOOL_LOOPS) {
      log('[ComputerUseSession] Reached max tool loops, stopping');
      this.sendToRenderer({
        type: 'stream.partial',
        payload: {
          sessionId: this.sessionId,
          delta: '\n\n*Reached maximum number of computer use actions. Please provide further instructions.*',
        },
      });
    }
  }
}
