import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('dev script guard', () => {
  it('keeps npm run dev free from bundled python preparation', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf-8')
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.dev).toBeDefined();
    expect(packageJson.scripts?.dev).not.toContain('prepare:python');
    expect(packageJson.scripts?.['dev:with-python']).toContain('prepare:python');
  });
});
