/**
 * @module main/skills/skill-progressive-loader
 *
 * Progressive disclosure for SKILL.md (mirrors Claude Code's pattern):
 *   - Startup: scan only frontmatter (name + description), NOT full content
 *   - Build a "Skill" function tool listing skills (≤250 chars per entry)
 *   - SKILL.md body only loaded when model invokes the tool
 *
 * vs. pi-coding-agent's DefaultResourceLoader which embeds full SKILL.md text in
 * the system prompt every turn (cost ≈ 9k input tokens for 5 bundled skills).
 *
 * Budget: cap total listing at min(20k chars, 1% × contextWindow); bundled skills
 * have priority; custom skills truncated first if over budget.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Type, type TSchema } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { log, logWarn } from '../utils/logger';

const MAX_LISTING_DESC_CHARS = 250;
const MIN_BUDGET_CHARS = 2000;
// 1M-context models can spare 20k chars (~5k tokens) for skill listings without
// hurting cost. Smaller models still get capped at 1% × ctx_window.
const MAX_BUDGET_CHARS = 20000;

export interface SkillEntry {
  name: string;
  description: string;
  filePath: string;
  bundled: boolean;
  rootDir: string;
}

interface FrontmatterFields {
  name?: string;
  description?: string;
}

/**
 * Parse YAML frontmatter (lightweight — only extracts top-level scalar `name` and
 * `description`). Returns null if no `---` block at file start.
 */
function parseFrontmatter(text: string): FrontmatterFields | null {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const body = text.slice(3, end);
  const fields: FrontmatterFields = {};
  // very small YAML subset — handle quoted/unquoted scalars on single lines
  const lines = body.split('\n');
  let inMultiline: 'name' | 'description' | null = null;
  let multilineBuf = '';
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (inMultiline) {
      if (/^\S/.test(line)) {
        // dedent end
        fields[inMultiline] = multilineBuf.trim();
        inMultiline = null;
        multilineBuf = '';
      } else {
        multilineBuf += line.trim() + ' ';
        continue;
      }
    }
    const m = /^(name|description)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as 'name' | 'description';
    let val = m[2].trim();
    if (val === '|' || val === '>') {
      inMultiline = key;
      multilineBuf = '';
      continue;
    }
    // strip optional matching quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  if (inMultiline && multilineBuf) {
    fields[inMultiline] = multilineBuf.trim();
  }
  return fields;
}

function truncateToChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Scan a list of skill root directories. Each root is expected to contain
 * <root>/<skill-name>/SKILL.md. Returns one entry per skill, with truncated
 * description.
 */
export function scanSkillFrontmatter(
  paths: Array<{ rootDir: string; bundled: boolean }>
): SkillEntry[] {
  const seen = new Map<string, SkillEntry>();
  for (const { rootDir, bundled } of paths) {
    if (!rootDir || !fs.existsSync(rootDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (err) {
      logWarn('[SkillLoader] readdir failed:', rootDir, err);
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const skillName = ent.name;
      if (skillName.startsWith('.')) continue;
      const filePath = path.join(rootDir, skillName, 'SKILL.md');
      if (!fs.existsSync(filePath)) continue;
      // bundled wins over user when same name appears
      if (seen.has(skillName) && !bundled) continue;
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const fm = parseFrontmatter(text);
        const description = fm?.description?.trim() || '';
        const name = (fm?.name?.trim() || skillName).trim();
        seen.set(name, {
          name,
          description: truncateToChars(description, MAX_LISTING_DESC_CHARS),
          filePath,
          bundled,
          rootDir,
        });
      } catch (err) {
        logWarn('[SkillLoader] read failed:', filePath, err);
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Build the system-prompt listing string for skills. Returns empty string when no
 * skills available. Total length capped at min(MAX_BUDGET_CHARS, contextWindow * 1%);
 * bundled skills protected, custom skills truncated first.
 */
export function buildSkillListing(
  entries: SkillEntry[],
  contextWindow: number = 128_000
): string {
  if (entries.length === 0) return '';
  const totalBudget = Math.min(
    Math.max(MIN_BUDGET_CHARS, Math.floor(contextWindow / 100)),
    MAX_BUDGET_CHARS
  );

  // Bundled first, custom last
  const sorted = [...entries].sort((a, b) => {
    if (a.bundled !== b.bundled) return a.bundled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const lines: string[] = [];
  let usedChars = 0;
  for (const entry of sorted) {
    const lineFull = `- ${entry.name}: ${entry.description}`;
    const overhead = lineFull.length + 1; // +1 newline
    if (usedChars + overhead <= totalBudget) {
      lines.push(lineFull);
      usedChars += overhead;
      continue;
    }
    // Over budget — bundled stays even if it busts, custom gets truncated to name only
    if (entry.bundled) {
      lines.push(lineFull);
      usedChars += overhead;
    } else {
      const lineMin = `- ${entry.name}`;
      if (usedChars + lineMin.length + 1 <= totalBudget) {
        lines.push(lineMin);
        usedChars += lineMin.length + 1;
      }
    }
  }

  return [
    '<available_skills>',
    `Below is the COMPLETE list of skills installed locally (${lines.length} total). When the user asks "do you have skill X" or "can you use X", you MUST scan this list and answer based on it — do not hallucinate or list a hardcoded subset. To load a skill's full instructions, call the Skill tool with the skill_name argument. Loaded content stays in history; no need to reload.`,
    ...lines,
    '</available_skills>',
  ].join('\n');
}

/**
 * Build the "Skill" function tool. The model calls Skill(skill_name=...) and the
 * SKILL.md body is read once and returned as text. The agent caches loaded skills
 * per-session via the provided `loadedSkills` Set so we can warn (not block) on
 * re-loads.
 */
export function buildSkillTool(
  entries: SkillEntry[],
  loadedSkills: Set<string>
): ToolDefinition<TSchema, unknown> {
  const byName = new Map(entries.map((e) => [e.name, e]));
  return {
    name: 'Skill',
    label: 'Skill',
    description:
      'Load a skill from the available_skills listing. Provides detailed instructions for tasks like spreadsheet/PDF/Word/PowerPoint manipulation. Call this once per skill per conversation; loaded content stays in chat history.',
    parameters: Type.Object({
      skill_name: Type.String({
        description: 'Exact skill name from the available_skills listing (e.g. "xlsx", "pdf").',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const skillName = (params as { skill_name?: string })?.skill_name?.trim() || '';
      if (!skillName) {
        return {
          content: [{ type: 'text' as const, text: 'Skill error: missing skill_name' }],
          details: undefined,
        };
      }
      const entry = byName.get(skillName);
      if (!entry) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Skill "${skillName}" not found. Available: ${Array.from(byName.keys()).join(', ')}`,
            },
          ],
          details: undefined,
        };
      }
      try {
        const text = fs.readFileSync(entry.filePath, 'utf-8');
        loadedSkills.add(entry.name);
        log(`[SkillLoader] Loaded skill "${entry.name}" (${text.length} chars)`);
        return {
          content: [{ type: 'text' as const, text }],
          details: undefined,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Skill load failed: ${msg}` }],
          details: undefined,
        };
      }
    },
  };
}
