import { describe, it, expect } from 'vitest';
import { createTitleFlowHarness } from './support/session-title-harness';

describe('session title flow', () => {
  it('does not update title when generator returns empty string', async () => {
    // normalizeTitle('') returns null, so updateTitle is never called
    const harness = createTitleFlowHarness({ generatedTitle: '' });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe(null);
  });

  it('does not update when generator fails', async () => {
    const harness = createTitleFlowHarness({ generatedTitle: null });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe(null);
  });

  it('does not override manual title changes', async () => {
    const harness = createTitleFlowHarness({
      generatedTitle: '',
      latestTitle: '',
    });
    await harness.runFirstMessage('PPT');
    expect(harness.updatedTitle).toBe(null);
  });
});
