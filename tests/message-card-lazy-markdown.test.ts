import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');

describe('MessageCard markdown splitting', () => {
  it('lazy loads the heavy markdown renderer instead of importing it directly', () => {
    const source = fs.readFileSync(messageCardPath, 'utf8');

    expect(source).not.toContain("import ReactMarkdown from 'react-markdown';");
    expect(source).not.toContain("import remarkMath from 'remark-math';");
    expect(source).not.toContain("import remarkGfm from 'remark-gfm';");
    expect(source).not.toContain("import rehypeKatex from 'rehype-katex';");
    expect(source).toContain("const MessageMarkdown = lazy(() => import('./MessageMarkdown').then");
    expect(source).toContain('<Suspense fallback=');
  });
});
