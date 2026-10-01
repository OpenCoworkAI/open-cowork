/**
 * Safe MCP config parsing shared by the main-process store and the settings UI.
 *
 * Agent-installed connectors (Claude-style `mcpServers` maps, Tavily stdio
 * entries without `type`/`id`, string `args`, etc.) must never crash the
 * Settings → MCP Connectors tab.
 *
 * Normalization is an in-memory view. It does not write, and the save/delete
 * helpers below only change the targeted entry inside the original collection
 * (array, keyed object, JSON string, or `mcpServers` map).
 */
import { isDeepStrictEqual } from 'node:util';
import type { McpServerConfig, McpServerStatus, McpTool } from './ipc-types';

export type McpTransportType = McpServerConfig['type'];

export interface NormalizeMcpConfigResult {
  servers: McpServerConfig[];
  repaired: boolean;
  source: 'servers' | 'mcpServers' | 'empty' | 'unknown';
  skipped: number;
  /** Present when a `servers` / `mcpServers` value could not be parsed. */
  error?: string;
}

export interface McpConnectorRenderFields {
  key: string;
  id: string;
  name: string;
  typeLabel: string;
  commandLine: string;
  url: string;
  enabled: boolean;
}

const VALID_TRANSPORTS = new Set<McpTransportType>(['stdio', 'sse', 'streamable-http']);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function formatMcpArgsInput(args?: unknown): string {
  if (Array.isArray(args)) {
    return args.map((item) => String(item)).join(' ');
  }
  if (typeof args === 'string') {
    return args;
  }
  return '';
}

export function formatMcpCommandLine(command?: string, args?: unknown): string {
  const cmd = typeof command === 'string' ? command : '';
  return `${cmd} ${formatMcpArgsInput(args)}`.trim();
}

export function formatMcpTypeLabel(type: string | undefined): string {
  return (type && type.trim() ? type : 'stdio').toUpperCase();
}

function normalizeTransportType(
  raw: unknown,
  hasCommand: boolean,
  hasUrl: boolean
): { type: McpTransportType; repaired: boolean } {
  const asString = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (VALID_TRANSPORTS.has(asString as McpTransportType)) {
    return { type: asString as McpTransportType, repaired: false };
  }

  if (
    asString === 'http' ||
    asString === 'streamablehttp' ||
    asString === 'streamable_http' ||
    asString === 'streamable'
  ) {
    return { type: 'streamable-http', repaired: true };
  }

  if (hasUrl && !hasCommand) {
    return { type: asString === 'sse' ? 'sse' : 'streamable-http', repaired: true };
  }

  return { type: 'stdio', repaired: true };
}

function normalizeArgs(raw: unknown): { args?: string[]; repaired: boolean } {
  if (raw == null) {
    return { repaired: false };
  }
  if (Array.isArray(raw)) {
    return { args: raw.map((item) => String(item)), repaired: false };
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return { args: trimmed ? trimmed.split(/\s+/) : [], repaired: true };
  }
  return { repaired: true };
}

function normalizeStringRecord(raw: unknown): {
  record?: Record<string, string>;
  repaired: boolean;
} {
  if (raw == null) {
    return { repaired: false };
  }
  if (Array.isArray(raw)) {
    const record: Record<string, string> = {};
    for (const item of raw) {
      if (typeof item === 'string' && item.includes('=')) {
        const eq = item.indexOf('=');
        record[item.slice(0, eq)] = item.slice(eq + 1);
      } else if (isPlainObject(item)) {
        const key = nonEmptyString(item.key) ?? nonEmptyString(item.name);
        if (key) {
          record[key] = item.value == null ? '' : String(item.value);
        }
      }
    }
    return { record: Object.keys(record).length > 0 ? record : undefined, repaired: true };
  }
  if (isPlainObject(raw)) {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value == null) {
        continue;
      }
      record[key] = String(value);
    }
    return { record, repaired: false };
  }
  return { repaired: true };
}

function normalizeEnabled(raw: unknown): { enabled: boolean; repaired: boolean } {
  if (typeof raw === 'boolean') {
    return { enabled: raw, repaired: false };
  }
  if (raw === 0 || raw === 'false' || raw === '0') {
    return { enabled: false, repaired: true };
  }
  if (raw === 1 || raw === 'true' || raw === '1') {
    return { enabled: true, repaired: true };
  }
  // Claude / agent-installed connectors omit `enabled`; they are meant to be active.
  return { enabled: true, repaired: raw !== undefined };
}

const SERVERS_JSON_ERROR =
  'MCP config `servers` is a string that is not valid JSON (expected an array or object).';
const MCP_SERVERS_SHAPE_ERROR =
  'MCP config `mcpServers` is not a valid server list or map (expected an object, array, or JSON string).';
const SERVERS_TYPE_ERROR =
  'MCP config `servers` has an unsupported type; expected an array, object, or JSON string.';
const UNSUPPORTED_DOCUMENT_ERROR =
  'MCP config document has an unsupported shape and was left unchanged.';

type McpConfigFieldName = 'servers' | 'mcpServers' | 'mcp_servers';

interface McpServerCollection {
  field: McpConfigFieldName;
  source: 'servers' | 'mcpServers';
  jsonEncoded: boolean;
  shape: 'array' | 'map';
  entries: Array<{ key?: string; entry: unknown }>;
  container: unknown[] | Record<string, unknown>;
  collectionRepaired: boolean;
}

type ResolveMcpServerCollectionResult =
  | { status: 'empty' }
  | { status: 'unknown' }
  | { status: 'invalid'; source: 'servers' | 'mcpServers'; error: string }
  | { status: 'collection'; collection: McpServerCollection };

const MANAGED_SERVER_KEYS: Array<keyof McpServerConfig> = [
  'id',
  'name',
  'type',
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'enabled',
];

export interface McpConfigWriteResult {
  ok: boolean;
  changed: boolean;
  field?: McpConfigFieldName;
  value?: unknown;
  error?: string;
}

function serversFieldNeedsRepair(value: unknown): boolean {
  return typeof value === 'string' || !Array.isArray(value);
}

function toServerCollection(
  field: McpConfigFieldName,
  value: unknown,
  source: 'servers' | 'mcpServers'
): McpServerCollection | undefined {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) {
    return {
      field,
      source,
      jsonEncoded: typeof value === 'string',
      shape: 'array',
      entries: parsed.map((entry) => ({ entry })),
      container: parsed,
      collectionRepaired: source === 'mcpServers' || serversFieldNeedsRepair(value),
    };
  }
  if (isPlainObject(parsed)) {
    return {
      field,
      source,
      jsonEncoded: typeof value === 'string',
      shape: 'map',
      entries: Object.entries(parsed).map(([key, entry]) => ({ key, entry })),
      container: parsed,
      collectionRepaired: true,
    };
  }
  return undefined;
}

/**
 * Pick the same collection `normalizeMcpConfigDocument` shows in the UI.
 * A non-empty `servers` value wins. An empty `servers` array (including one
 * merged from store defaults) does not hide Claude-style `mcpServers`.
 */
function resolveMcpServerCollection(raw: unknown): ResolveMcpServerCollectionResult {
  const parsed = parseJsonIfString(raw);
  if (parsed == null) {
    return { status: 'empty' };
  }
  if (Array.isArray(parsed)) {
    const collection = toServerCollection('servers', parsed, 'servers');
    return collection ? { status: 'collection', collection } : { status: 'unknown' };
  }
  if (!isPlainObject(parsed)) {
    return { status: 'unknown' };
  }

  const serversField = parsed.servers;
  const mcpServersField = parsed.mcpServers ?? parsed.mcp_servers;
  const mcpFieldName: McpConfigFieldName | undefined =
    parsed.mcpServers != null
      ? 'mcpServers'
      : parsed.mcp_servers != null
        ? 'mcp_servers'
        : undefined;
  const serversCollection =
    serversField !== undefined ? toServerCollection('servers', serversField, 'servers') : undefined;
  const serversUnreadable = typeof serversField === 'string' && serversCollection === undefined;

  if (serversCollection && serversCollection.entries.length > 0) {
    return { status: 'collection', collection: serversCollection };
  }

  if (mcpServersField != null) {
    const mcpCollection = mcpFieldName
      ? toServerCollection(mcpFieldName, mcpServersField, 'mcpServers')
      : undefined;
    if (!mcpCollection) {
      return {
        status: 'invalid',
        source: 'mcpServers',
        error: serversUnreadable ? SERVERS_JSON_ERROR : MCP_SERVERS_SHAPE_ERROR,
      };
    }
    return { status: 'collection', collection: mcpCollection };
  }

  if (serversUnreadable) {
    return { status: 'invalid', source: 'servers', error: SERVERS_JSON_ERROR };
  }

  if (serversCollection) {
    return { status: 'collection', collection: serversCollection };
  }

  if (serversField === undefined && mcpServersField === undefined) {
    return { status: 'empty' };
  }

  return { status: 'invalid', source: 'servers', error: SERVERS_TYPE_ERROR };
}

export function normalizeMcpServerEntry(
  raw: unknown,
  fallbackKey?: string,
  usedIds?: Set<string>
): { server: McpServerConfig | null; repaired: boolean } {
  if (!isPlainObject(raw)) {
    return { server: null, repaired: true };
  }

  const command = nonEmptyString(raw.command);
  const url = nonEmptyString(raw.url);
  const transportRaw = raw.type ?? raw.transport;
  const transport = normalizeTransportType(transportRaw, Boolean(command), Boolean(url));
  const args = normalizeArgs(raw.args);
  const env = normalizeStringRecord(raw.env);
  const headers = normalizeStringRecord(raw.headers);
  const enabled = normalizeEnabled(raw.enabled);
  const cwd = nonEmptyString(raw.cwd);

  const name =
    nonEmptyString(raw.name) ?? nonEmptyString(fallbackKey) ?? command ?? url ?? 'MCP Server';

  let id = nonEmptyString(raw.id);
  let idRepaired = false;
  if (!id) {
    id = slugify(name)
      ? `mcp-${slugify(name)}`
      : `mcp-${slugify(fallbackKey || 'server') || 'server'}`;
    idRepaired = true;
  }
  if (usedIds) {
    const baseId = id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
      idRepaired = true;
    }
    usedIds.add(id);
  }

  const server: McpServerConfig = {
    id,
    name,
    type: transport.type,
    enabled: enabled.enabled,
  };

  if (command) {
    server.command = command;
  }
  if (args.args) {
    server.args = args.args;
  }
  if (env.record) {
    server.env = env.record;
  }
  if (cwd) {
    server.cwd = cwd;
  }
  if (url) {
    server.url = url;
  }
  if (headers.record) {
    server.headers = headers.record;
  }

  const repaired =
    idRepaired ||
    transport.repaired ||
    args.repaired ||
    env.repaired ||
    headers.repaired ||
    enabled.repaired ||
    !nonEmptyString(raw.name);

  return { server, repaired };
}

function normalizeEntries(
  entries: Array<{ key?: string; entry: unknown }>,
  source: NormalizeMcpConfigResult['source'],
  collectionRepaired: boolean
): NormalizeMcpConfigResult {
  const usedIds = new Set<string>();
  const servers: McpServerConfig[] = [];
  let skipped = 0;
  let entryRepaired = false;

  for (const item of entries) {
    const normalized = normalizeMcpServerEntry(item.entry, item.key, usedIds);
    if (!normalized.server) {
      skipped += 1;
      entryRepaired = true;
      continue;
    }
    if (normalized.repaired) {
      entryRepaired = true;
    }
    servers.push(normalized.server);
  }

  return {
    servers,
    repaired: collectionRepaired || entryRepaired,
    source,
    skipped,
  };
}

/**
 * Normalize a full `mcp-config.json` document, a `servers` array, or a Claude
 * Desktop `{ mcpServers: { ... } }` map into Open Cowork server configs.
 *
 * The result is only an in-memory view. Callers must not write it back over
 * the original document.
 */
export function normalizeMcpConfigDocument(raw: unknown): NormalizeMcpConfigResult {
  const resolved = resolveMcpServerCollection(raw);
  if (resolved.status === 'empty') {
    return { servers: [], repaired: false, source: 'empty', skipped: 0 };
  }
  if (resolved.status === 'unknown') {
    return { servers: [], repaired: true, source: 'unknown', skipped: 0 };
  }
  if (resolved.status === 'invalid') {
    return {
      servers: [],
      repaired: true,
      source: resolved.source,
      skipped: 0,
      error: resolved.error,
    };
  }
  return normalizeEntries(
    resolved.collection.entries,
    resolved.collection.source,
    resolved.collection.collectionRepaired
  );
}

function cloneCollectionContainer(
  collection: McpServerCollection
): unknown[] | Record<string, unknown> {
  if (collection.shape === 'array') {
    return [...(collection.container as unknown[])];
  }
  return { ...(collection.container as Record<string, unknown>) };
}

function encodeCollectionContainer(
  collection: McpServerCollection,
  container: unknown[] | Record<string, unknown>
): unknown {
  return collection.jsonEncoded ? JSON.stringify(container) : container;
}

function withUpdatedField(raw: unknown, field: McpConfigFieldName, value: unknown): unknown {
  if (Array.isArray(raw)) {
    return value;
  }
  if (!isPlainObject(raw)) {
    return { [field]: value };
  }
  return { ...raw, [field]: value };
}

function findStoredServerEntry(
  collection: McpServerCollection,
  serverId: string
): { index: number; key?: string; entry: unknown; normalized: McpServerConfig } | undefined {
  const usedIds = new Set<string>();
  for (let index = 0; index < collection.entries.length; index += 1) {
    const item = collection.entries[index];
    const normalized = normalizeMcpServerEntry(item.entry, item.key, usedIds);
    if (normalized.server?.id === serverId) {
      return {
        index,
        key: item.key,
        entry: item.entry,
        normalized: normalized.server,
      };
    }
  }
  return undefined;
}

/**
 * Apply only the fields that differ from the normalized view, so a save does
 * not rewrite Claude-only fields (`type: "http"`, string `args`, omitted
 * `enabled`) when the user did not change them. The stable id is written once
 * the entry is actually edited, so the next read still addresses that entry.
 */
function patchStoredServerEntry(
  rawEntry: unknown,
  normalized: McpServerConfig,
  saved: McpServerConfig
): { entry: Record<string, unknown>; changed: boolean } {
  const base: Record<string, unknown> = isPlainObject(rawEntry) ? { ...rawEntry } : {};
  let changed = false;
  for (const key of MANAGED_SERVER_KEYS) {
    const nextValue = saved[key];
    if (isDeepStrictEqual(nextValue, normalized[key])) {
      continue;
    }
    changed = true;
    if (nextValue === undefined) {
      delete base[key];
    } else {
      base[key] = nextValue;
    }
  }
  if (changed && base.id !== saved.id) {
    base.id = saved.id;
  }
  return { entry: base, changed };
}

function allocateMapKey(entries: Array<{ key?: string }>, server: McpServerConfig): string {
  const used = new Set(entries.flatMap((entry) => (entry.key ? [entry.key] : [])));
  const preferred = server.name.trim() || server.id;
  if (!used.has(preferred)) {
    return preferred;
  }
  if (!used.has(server.id)) {
    return server.id;
  }
  let suffix = 2;
  let candidate = `${preferred}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${preferred}-${suffix}`;
  }
  return candidate;
}

function blockedWrite(resolved: ResolveMcpServerCollectionResult): McpConfigWriteResult {
  if (resolved.status === 'invalid') {
    return { ok: false, changed: false, error: resolved.error };
  }
  return { ok: false, changed: false, error: UNSUPPORTED_DOCUMENT_ERROR };
}

function putEntry(
  collection: McpServerCollection,
  container: unknown[] | Record<string, unknown>,
  index: number,
  key: string | undefined,
  entry: unknown
): void {
  if (collection.shape === 'array') {
    (container as unknown[])[index] = entry;
    return;
  }
  if (key) {
    (container as Record<string, unknown>)[key] = entry;
  }
}

function removeEntry(
  collection: McpServerCollection,
  container: unknown[] | Record<string, unknown>,
  index: number,
  key: string | undefined
): void {
  if (collection.shape === 'array') {
    (container as unknown[]).splice(index, 1);
    return;
  }
  if (key) {
    delete (container as Record<string, unknown>)[key];
  }
}

/**
 * Insert or update one server inside the original document shape.
 * Unrecognized siblings and every other entry stay as they were.
 */
export function upsertServerInMcpDocument(
  raw: unknown,
  server: McpServerConfig
): McpConfigWriteResult {
  const resolved = resolveMcpServerCollection(raw);
  if (resolved.status === 'empty') {
    return { ok: true, changed: true, field: 'servers', value: [server] };
  }
  if (resolved.status !== 'collection') {
    return blockedWrite(resolved);
  }

  const collection = resolved.collection;
  const match = findStoredServerEntry(collection, server.id);
  const container = cloneCollectionContainer(collection);
  if (!match) {
    if (collection.shape === 'array') {
      (container as unknown[]).push(server);
    } else {
      (container as Record<string, unknown>)[allocateMapKey(collection.entries, server)] = server;
    }
    return {
      ok: true,
      changed: true,
      field: collection.field,
      value: encodeCollectionContainer(collection, container),
    };
  }

  const patched = patchStoredServerEntry(match.entry, match.normalized, server);
  if (!patched.changed) {
    return { ok: true, changed: false };
  }
  putEntry(collection, container, match.index, match.key, patched.entry);
  return {
    ok: true,
    changed: true,
    field: collection.field,
    value: encodeCollectionContainer(collection, container),
  };
}

/** Remove one recognized server. Unrecognized siblings stay in place. */
export function deleteServerFromMcpDocument(raw: unknown, serverId: string): McpConfigWriteResult {
  const resolved = resolveMcpServerCollection(raw);
  if (resolved.status === 'empty') {
    return { ok: true, changed: false };
  }
  if (resolved.status !== 'collection') {
    return blockedWrite(resolved);
  }

  const collection = resolved.collection;
  const match = findStoredServerEntry(collection, serverId);
  if (!match) {
    return { ok: true, changed: false };
  }
  const container = cloneCollectionContainer(collection);
  removeEntry(collection, container, match.index, match.key);
  return {
    ok: true,
    changed: true,
    field: collection.field,
    value: encodeCollectionContainer(collection, container),
  };
}

/**
 * Replace the recognized server list without flattening the document or
 * dropping unrecognized entries.
 */
export function replaceRecognizedServersInMcpDocument(
  raw: unknown,
  servers: McpServerConfig[]
): McpConfigWriteResult {
  const recognized = normalizeMcpConfigDocument(raw);
  if (recognized.error) {
    return { ok: false, changed: false, error: recognized.error };
  }

  const nextIds = new Set(servers.map((server) => server.id));
  let current = raw;
  let last: McpConfigWriteResult = { ok: true, changed: false };

  for (const existing of recognized.servers) {
    if (nextIds.has(existing.id)) {
      continue;
    }
    const deleted = deleteServerFromMcpDocument(current, existing.id);
    if (!deleted.ok || !deleted.changed || !deleted.field) {
      if (!deleted.ok) {
        return deleted;
      }
      continue;
    }
    current = withUpdatedField(current, deleted.field, deleted.value);
    last = deleted;
  }

  for (const server of servers) {
    const upserted = upsertServerInMcpDocument(current, server);
    if (!upserted.ok) {
      return upserted;
    }
    if (!upserted.changed || !upserted.field) {
      continue;
    }
    current = withUpdatedField(current, upserted.field, upserted.value);
    last = upserted;
  }

  return last;
}

/** Normalize whatever the MCP settings IPC / store might return. */
export function normalizeMcpConfigInput(raw: unknown): NormalizeMcpConfigResult {
  return normalizeMcpConfigDocument(raw);
}

export function collectMcpConnectorRenderFields(
  servers: McpServerConfig[]
): McpConnectorRenderFields[] {
  return servers.map((server) => ({
    key: server.id,
    id: server.id,
    name: server.name,
    typeLabel: formatMcpTypeLabel(server.type),
    commandLine: formatMcpCommandLine(server.command, server.args),
    url: server.url ?? '',
    enabled: server.enabled,
  }));
}

export function normalizeMcpStatusList(raw: unknown): McpServerStatus[] {
  return asArray<unknown>(raw).flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }
    const id = nonEmptyString(item.id);
    if (!id) {
      return [];
    }
    const statusRaw = nonEmptyString(item.status);
    const status: McpServerStatus['status'] =
      statusRaw === 'connecting' ||
      statusRaw === 'connected' ||
      statusRaw === 'failed' ||
      statusRaw === 'disabled'
        ? statusRaw
        : item.connected
          ? 'connected'
          : 'disabled';
    return [
      {
        id,
        name: nonEmptyString(item.name) ?? id,
        connected: Boolean(item.connected),
        status,
        toolCount:
          typeof item.toolCount === 'number' && Number.isFinite(item.toolCount)
            ? item.toolCount
            : 0,
      },
    ];
  });
}

export function normalizeMcpToolList(
  raw: unknown
): Array<Pick<McpTool, 'name' | 'serverId'> & { description?: string }> {
  return asArray<unknown>(raw).flatMap((item) => {
    if (!isPlainObject(item)) {
      return [];
    }
    return [
      {
        serverId: nonEmptyString(item.serverId) ?? '',
        name: nonEmptyString(item.name) ?? '',
        description: nonEmptyString(item.description),
      },
    ];
  });
}

export function normalizeMcpPresetMap<T>(raw: unknown): Record<string, T> {
  return isPlainObject(raw) ? (raw as Record<string, T>) : {};
}
