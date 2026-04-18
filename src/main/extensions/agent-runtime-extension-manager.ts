import type {
  AgentRuntimeCustomTool,
  AgentRuntimeExtension,
  AfterSessionRunContext,
  BeforeSessionRunContext,
  BeforeSessionRunResult,
  SessionDeletedContext,
} from './agent-runtime-extension';
import { logError, logWarn } from '../utils/logger';

function mergeCustomTools(tools: AgentRuntimeCustomTool[]): AgentRuntimeCustomTool[] {
  const merged = new Map<string, AgentRuntimeCustomTool>();
  for (const tool of tools) {
    if (!tool?.name) {
      continue;
    }
    if (merged.has(tool.name)) {
      logWarn(`[AgentRuntimeExtensionManager] Duplicate custom tool overridden: ${tool.name}`);
    }
    merged.set(tool.name, tool);
  }
  return Array.from(merged.values());
}

export class AgentRuntimeExtensionManager {
  private readonly extensions: AgentRuntimeExtension[];

  constructor(extensions: AgentRuntimeExtension[] = []) {
    this.extensions = [...extensions];
  }

  register(extension: AgentRuntimeExtension): void {
    this.extensions.push(extension);
  }

  async beforeSessionRun(context: BeforeSessionRunContext): Promise<BeforeSessionRunResult> {
    const promptPrefixes: string[] = [];
    const customTools: AgentRuntimeCustomTool[] = [];

    for (const extension of this.extensions) {
      if (!extension.beforeSessionRun) {
        continue;
      }
      try {
        const result = await extension.beforeSessionRun(context);
        if (!result) {
          continue;
        }
        if (result.promptPrefix?.trim()) {
          promptPrefixes.push(result.promptPrefix.trim());
        }
        if (result.customTools?.length) {
          customTools.push(...result.customTools);
        }
      } catch (error) {
        logError(
          `[AgentRuntimeExtensionManager] beforeSessionRun failed for ${extension.name}:`,
          error
        );
      }
    }

    return {
      promptPrefix: promptPrefixes.join('\n\n').trim() || undefined,
      customTools: mergeCustomTools(customTools),
    };
  }

  async afterSessionRun(context: AfterSessionRunContext): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.afterSessionRun) {
          return;
        }
        try {
          await extension.afterSessionRun(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] afterSessionRun failed for ${extension.name}:`,
            error
          );
        }
      })
    );
  }

  async onSessionDeleted(context: SessionDeletedContext): Promise<void> {
    await Promise.allSettled(
      this.extensions.map(async (extension) => {
        if (!extension.onSessionDeleted) {
          return;
        }
        try {
          await extension.onSessionDeleted(context);
        } catch (error) {
          logError(
            `[AgentRuntimeExtensionManager] onSessionDeleted failed for ${extension.name}:`,
            error
          );
        }
      })
    );
  }
}
