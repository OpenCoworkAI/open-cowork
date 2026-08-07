import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

const indexPath = path.resolve(process.cwd(), 'src/main/index.ts');

describe('buildAgentRuntimeSignature', () => {
  it('includes contextWindow and maxTokens so a numeric-only change reloads the running session', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const signatureBlock = source.match(
      /const buildAgentRuntimeSignature[\s\S]*?\n  \}\);/
    )?.[0] || '';

    expect(signatureBlock).toContain('contextWindow: config.contextWindow');
    expect(signatureBlock).toContain('maxTokens: config.maxTokens');
  });
});
