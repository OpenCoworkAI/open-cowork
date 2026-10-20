import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CoreMemoryEditor } from '../../renderer/components/settings/CoreMemoryEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('CoreMemoryEditor', () => {
  it('renders only the heading until the first load finishes', () => {
    const markup = renderToStaticMarkup(
      createElement(CoreMemoryEditor, {
        overview: null,
        disabled: false,
        onChanged: () => {},
        onStatus: () => {},
      })
    );

    expect(markup).toContain('memory.coreEditorTitle');
    expect(markup).not.toContain('memory.coreEditorEmpty');
  });
});
