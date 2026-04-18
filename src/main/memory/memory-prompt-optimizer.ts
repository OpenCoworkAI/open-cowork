import type { MemoryLLMClientLike } from './memory-llm-client';
import { DEFAULT_MEMORY_PROMPTS, PROMPT_ITERATION_SYSTEM_PROMPT, type MemoryPromptSet } from './memory-prompts';
import type { MemoryEvalReport } from './memory-eval-harness';
import { extractJson } from './memory-utils';

export interface MemoryPromptOptimizationResult {
  prompts: MemoryPromptSet;
  baselineScore: number;
  bestScore: number;
  iterations: Array<{
    round: number;
    candidatePrompts: Partial<MemoryPromptSet>;
    score: number;
    accepted: boolean;
  }>;
}

export class MemoryPromptOptimizer {
  constructor(private readonly llm: MemoryLLMClientLike) {}

  async optimize(options: {
    baselinePrompts?: Partial<MemoryPromptSet>;
    baselineReport: MemoryEvalReport;
    rounds: number;
    evaluate: (prompts: MemoryPromptSet) => Promise<MemoryEvalReport>;
  }): Promise<MemoryPromptOptimizationResult> {
    let bestPrompts: MemoryPromptSet = {
      ...DEFAULT_MEMORY_PROMPTS,
      ...options.baselinePrompts,
    };
    let bestScore = options.baselineReport.averageScore;
    const baselineScore = bestScore;
    const iterations: MemoryPromptOptimizationResult['iterations'] = [];

    for (let round = 1; round <= options.rounds; round += 1) {
      const candidatePrompts = await this.generateCandidate(bestPrompts, options.baselineReport, round);
      if (!candidatePrompts) {
        iterations.push({ round, candidatePrompts: {}, score: bestScore, accepted: false });
        continue;
      }
      const merged: MemoryPromptSet = {
        ...bestPrompts,
        ...candidatePrompts,
      };
      const report = await options.evaluate(merged);
      const accepted = report.averageScore > bestScore;
      if (accepted) {
        bestPrompts = merged;
        bestScore = report.averageScore;
      }
      iterations.push({
        round,
        candidatePrompts,
        score: report.averageScore,
        accepted,
      });
    }

    return {
      prompts: bestPrompts,
      baselineScore,
      bestScore,
      iterations,
    };
  }

  private async generateCandidate(
    prompts: MemoryPromptSet,
    report: MemoryEvalReport,
    round: number
  ): Promise<Partial<MemoryPromptSet> | null> {
    try {
      const response = await this.llm.complete({
        systemPrompt: PROMPT_ITERATION_SYSTEM_PROMPT,
        userPrompt: [
          `Round: ${round}`,
          `Current score: ${report.averageScore}`,
          '',
          'Current prompts:',
          JSON.stringify(prompts, null, 2),
          '',
          'Latest eval report:',
          JSON.stringify(report, null, 2),
        ].join('\n'),
        temperature: 0,
        maxTokens: 4000,
      });
      const parsed = extractJson(response.text);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      const candidateContainer = parsed as {
        candidates?: Array<Partial<MemoryPromptSet>>;
      };
      const candidate =
        Array.isArray(candidateContainer.candidates) && candidateContainer.candidates.length > 0
          ? candidateContainer.candidates[0]
          : (parsed as Partial<MemoryPromptSet>);
      const next: Partial<MemoryPromptSet> = {};
      if (typeof candidate.coreMemoryUpdateSystemPrompt === 'string') {
        next.coreMemoryUpdateSystemPrompt = candidate.coreMemoryUpdateSystemPrompt.trim();
      }
      if (typeof candidate.sessionChunkExtractionPrompt === 'string') {
        next.sessionChunkExtractionPrompt = candidate.sessionChunkExtractionPrompt.trim();
      }
      if (typeof candidate.memoryNavigationPrompt === 'string') {
        next.memoryNavigationPrompt = candidate.memoryNavigationPrompt.trim();
      }
      return Object.keys(next).length ? next : null;
    } catch {
      return null;
    }
  }
}
