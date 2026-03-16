/**
 * Convert LaTeX-standard delimiters to dollar-sign delimiters.
 * remark-math only recognises $…$ / $$…$$, but many models emit \(…\) / \[…\].
 * Code blocks (fenced and inline) are preserved to avoid false conversions.
 */
export function normalizeLatexDelimiters(text: string): string {
  if (!text) return text;

  const preserved: string[] = [];

  // 1. Protect fenced code blocks (``` … ```)
  let out = text.replace(/```[\s\S]*?```/g, (m) => {
    preserved.push(m);
    return `\x00P${preserved.length - 1}\x00`;
  });

  // 2. Protect inline code (` … `)
  out = out.replace(/`[^`\n]+`/g, (m) => {
    preserved.push(m);
    return `\x00P${preserved.length - 1}\x00`;
  });

  // 3. \(…\) → $…$  (inline math)
  out = out.replace(/\\\((.+?)\\\)/g, (_, c) => `$${c}$`);

  // 4. \[…\] → $$…$$ (display math, may span lines)
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, c) => `$$${c}$$`);

  // 5. Restore protected blocks
  out = out.replace(/\x00P(\d+)\x00/g, (_, i) => preserved[+i]);

  return out;
}
