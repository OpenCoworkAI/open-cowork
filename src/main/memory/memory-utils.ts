import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ContentBlock, Message } from '../../renderer/types';
import type {
  AppliedCoreMemoryAction,
  CoreMemoryActionInput,
  CoreMemoryCategory,
  CoreMemoryEntry,
  MemoryTranscriptTurn,
} from './memory-types';

const EN_STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'your',
  'have',
  'will',
  'into',
  'about',
  'please',
  'using',
  'user',
  'assistant',
  'need',
  'want',
  'help',
  'make',
  'just',
  'then',
  'than',
  'them',
  'they',
  'their',
  'there',
  'here',
  'been',
  'were',
  'when',
  'what',
  'which',
  'where',
  'while',
  'after',
  'before',
  'should',
  'could',
  'would',
  'current',
  'project',
  'workspace',
  'session',
  'continue',
  'based',
]);

const ZH_STOP_WORDS = ['我们', '你们', '他们', '进行', '一个', '这个', '那个', '需要', '可以', '已经'];
const CORE_CATEGORIES = new Set<CoreMemoryCategory>([
  'identity',
  'preferences',
  'skills',
  'interests',
]);

export function normalizeWorkspaceKey(cwd?: string | null): string | null {
  if (!cwd) {
    return null;
  }
  try {
    return path.resolve(cwd);
  } catch {
    return cwd;
  }
}

export function hashWorkspaceKey(workspaceKey: string): string {
  return crypto.createHash('sha1').update(workspaceKey).digest('hex').slice(0, 16);
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  if (!fs.existsSync(filePath)) {
    return defaultValue;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return defaultValue;
    }
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function saveJsonFile(filePath: string, data: unknown): void {
  ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

export function safeRemoveFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function isoNow(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 19);
}

export function extractJson(rawText: string): unknown {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const match = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

export function extractTextFromContent(content: ContentBlock[]): string {
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.thinking;
        case 'tool_result':
          return block.content;
        case 'tool_use':
          return `${block.name} ${JSON.stringify(block.input)}`;
        case 'file_attachment':
          return `[file] ${block.filename}`;
        case 'image':
          return '[image]';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function messagesToTranscript(messages: Message[]): MemoryTranscriptTurn[] {
  return messages
    .map((message): MemoryTranscriptTurn | null => {
      const content = extractTextFromContent(message.content);
      if (!content) {
        return null;
      }
      return {
        role: message.role,
        content,
        messageId: message.id,
        timestamp: message.timestamp,
      };
    })
    .filter((item): item is MemoryTranscriptTurn => Boolean(item));
}

export function compactTranscript(turns: MemoryTranscriptTurn[]): string {
  return turns.map((turn) => `${turn.role}: ${turn.content.trim()}`).join('\n');
}

export function summarizeText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function tokenizeSearchQuery(query: string): string[] {
  return Array.from(new Set(simpleTokenize(query))).slice(0, 16);
}

export function simpleTokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}|[\u4e00-\u9fff]{2,}/g) || []).filter(
    (token) => !EN_STOP_WORDS.has(token) && !ZH_STOP_WORDS.includes(token)
  );
}

export function lexicalScore(query: string, text: string): number {
  const queryTerms = new Map<string, number>();
  for (const token of simpleTokenize(query)) {
    queryTerms.set(token, (queryTerms.get(token) || 0) + 1);
  }
  const itemTerms = new Map<string, number>();
  for (const token of simpleTokenize(text)) {
    itemTerms.set(token, (itemTerms.get(token) || 0) + 1);
  }
  if (!queryTerms.size || !itemTerms.size) {
    return 0;
  }
  let overlap = 0;
  let queryCount = 0;
  let itemCount = 0;
  for (const value of queryTerms.values()) {
    queryCount += value;
  }
  for (const value of itemTerms.values()) {
    itemCount += value;
  }
  for (const [term, count] of queryTerms.entries()) {
    overlap += Math.min(count, itemTerms.get(term) || 0);
  }
  return overlap / Math.sqrt(queryCount * Math.max(itemCount, 1));
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function extractKeywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const token of simpleTokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function stripTrailingSlashes(value?: string): string | undefined {
  return value?.trim().replace(/\/+$/, '') || undefined;
}

export function resolveCoreCombinedKey(
  category: CoreMemoryCategory | undefined,
  key: string
): string {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return '';
  }
  if (category && CORE_CATEGORIES.has(category)) {
    return `${category}.${trimmedKey}`;
  }
  return trimmedKey;
}

export function parseCoreCombinedKey(combinedKey: string): CoreMemoryEntry {
  const trimmed = combinedKey.trim();
  const separator = trimmed.indexOf('.');
  if (separator > 0) {
    const category = trimmed.slice(0, separator) as CoreMemoryCategory;
    if (CORE_CATEGORIES.has(category)) {
      return {
        combinedKey: trimmed,
        category,
        key: trimmed.slice(separator + 1),
        value: '',
      };
    }
  }
  return {
    combinedKey: trimmed,
    key: trimmed,
    value: '',
  };
}

export function applyCoreMemoryActions(
  existingMemory: Record<string, string>,
  actions: CoreMemoryActionInput[]
): {
  nextMemory: Record<string, string>;
  applied: AppliedCoreMemoryAction[];
} {
  const nextMemory = { ...existingMemory };
  const applied: AppliedCoreMemoryAction[] = [];

  for (const action of actions) {
    const op = action.op;
    const combinedKey = resolveCoreCombinedKey(action.category, action.key);
    if (!combinedKey) {
      continue;
    }

    if (op === 'delete') {
      delete nextMemory[combinedKey];
      applied.push({
        op,
        category: action.category,
        key: action.key,
        combinedKey,
      });
      continue;
    }

    const value = typeof action.value === 'string' ? action.value.trim() : '';
    if (!value) {
      continue;
    }

    nextMemory[combinedKey] = value;
    applied.push({
      op,
      category: action.category,
      key: action.key,
      value,
      combinedKey,
    });
  }

  return { nextMemory, applied };
}

export function coreMemoryToPromptBlock(memory: Record<string, string>): string {
  const entries = Object.entries(memory);
  if (!entries.length) {
    return 'None';
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

export function clampInt(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function getFileTimestampMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

export function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function isSubPath(filePath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
