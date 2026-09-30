import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export interface SubagentPreset {
  name: string;
  description: string;
  prompt: string;
  model: string;
  allowedTools?: string[];
}

export interface SubagentConfig {
  model: string;
  defaultAgent: string;
  maxConcurrent: number;
  presets: SubagentPreset[];
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  model: '',
  defaultAgent: '',
  maxConcurrent: 3,
  presets: [
    {
      name: 'reviewer',
      description: 'Review code for correctness, regressions, and missing tests.',
      prompt:
        'Review the requested code. Report actionable findings with file references. Keep files unchanged.',
      model: '',
      allowedTools: ['read', 'grep', 'find', 'ls'],
    },
    {
      name: 'researcher',
      description: 'Investigate the codebase and explain the relevant implementation.',
      prompt:
        'Investigate the requested topic in the codebase. Cite evidence and keep files unchanged.',
      model: '',
      allowedTools: ['read', 'grep', 'find', 'ls'],
    },
    {
      name: 'implementer',
      description: 'Implement and verify a focused code change.',
      prompt:
        'Implement the requested change using existing project conventions and verify the result.',
      model: '',
    },
  ],
};

const configSchema = Type.Object({
  model: Type.String({ maxLength: 200 }),
  defaultAgent: Type.String({ maxLength: 64 }),
  maxConcurrent: Type.Integer({ minimum: 1, maximum: 8 }),
  presets: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1, maxLength: 64 }),
      description: Type.String({ maxLength: 1000 }),
      prompt: Type.String({ minLength: 1, maxLength: 10000 }),
      model: Type.String({ maxLength: 200 }),
      allowedTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    }),
    { maxItems: 30 }
  ),
});

export function normalizeSubagentConfig(input: unknown = DEFAULT_SUBAGENT_CONFIG): SubagentConfig {
  if (!Value.Check(configSchema, input)) {
    throw new Error(
      'Invalid subagent configuration: provide model, defaultAgent, maxConcurrent (1-8), and valid presets.'
    );
  }
  const config = input as SubagentConfig;
  const names = new Set<string>();
  const presets = config.presets.map((preset) => {
    const name = preset.name.trim();
    if (!name || names.has(name) || !preset.prompt.trim()) {
      throw new Error('Subagent presets require unique names and nonempty instructions.');
    }
    names.add(name);
    return {
      ...preset,
      name,
      model: preset.model.trim(),
      allowedTools: preset.allowedTools?.map((tool) => tool.trim()),
    };
  });
  const defaultAgent = config.defaultAgent.trim();
  if (defaultAgent && !names.has(defaultAgent)) {
    throw new Error(`Unknown default subagent: ${defaultAgent}`);
  }
  return { model: config.model.trim(), defaultAgent, maxConcurrent: config.maxConcurrent, presets };
}
