import { randomUUID } from 'node:crypto';
import type {
  AgentRuntimeExtension,
  BeforeSessionRunResult,
} from '../extensions/agent-runtime-extension';
import type { MemoryService } from './memory-service';

export class MemoryExtension implements AgentRuntimeExtension {
  readonly name = 'memory';

  constructor(private readonly memoryService: MemoryService) {}

  async beforeSessionRun({
    session,
    prompt,
  }: Parameters<
    NonNullable<AgentRuntimeExtension['beforeSessionRun']>
  >[0]): Promise<BeforeSessionRunResult | void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }

    const { promptPrefix, used } = await this.memoryService.buildPromptContext(session, prompt);
    return {
      promptPrefix,
      traceSteps: used.length
        ? [
            {
              id: randomUUID(),
              type: 'memory',
              status: 'completed',
              title: 'Memory used',
              memoryItems: used,
              timestamp: Date.now(),
            },
          ]
        : [],
    };
  }

  async afterSessionRun({
    session,
    prompt,
    messages,
  }: Parameters<NonNullable<AgentRuntimeExtension['afterSessionRun']>>[0]): Promise<void> {
    if (!this.memoryService.isEnabled() || !session.memoryEnabled) {
      return;
    }
    await this.memoryService.enqueueIngestion({
      session,
      prompt,
      messages,
    });
  }

  async onSessionDeleted({
    sessionId,
  }: Parameters<NonNullable<AgentRuntimeExtension['onSessionDeleted']>>[0]): Promise<void> {
    await this.memoryService.deleteSession(sessionId);
  }
}
