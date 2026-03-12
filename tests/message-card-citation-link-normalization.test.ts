import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const messageCardPath = path.resolve(process.cwd(), 'src/renderer/components/MessageCard.tsx');
const messageCardContent = fs.readFileSync(messageCardPath, 'utf8');

describe('MessageCard citation link normalization', () => {
  it('normalizes citation-style ~[title](url)~ to regular markdown links before render', () => {
    expect(messageCardContent).toContain('function normalizeCitationMarkdownLinks');
    expect(messageCardContent).toContain("return markdown.replace(/~\\[(.+?)\\]\\(([^)\\s]+)\\)~/g, '[$1]($2)');");
    expect(messageCardContent).toContain('normalizeCitationMarkdownLinks(normalizeLocalFileMarkdownLinks(text))');
  });

  it('disables remark-gfm single-tilde strikethrough parsing for safety', () => {
    expect(messageCardContent).toContain('remarkPlugins={[remarkMath, [remarkGfm, { singleTilde: false }]]}');
  });
});
