import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type LocalAuthProvider = 'codex' | 'claude';

export interface LocalAuthStatus {
  provider: LocalAuthProvider;
  available: boolean;
  path: string;
  profile?: string;
  account?: string;
  expiresAt?: string;
  updatedAt?: string;
}

export interface ImportedLocalAuthToken {
  provider: LocalAuthProvider;
  token: string;
  path: string;
  profile?: string;
  account?: string;
  expiresAt?: string;
  updatedAt?: string;
}

type ParsedToken = {
  token: string;
  profile?: string;
  account?: string;
  expiresAt?: string;
  updatedAt?: string;
};

const CODEX_AUTH_PATH = path.join(os.homedir(), '.codex', 'auth.json');
const CLAUDE_AUTH_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getStringField = (source: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const readJsonFile = (filePath: string): unknown | null => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

export function parseCodexAuthPayload(payload: unknown): ParsedToken | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const nestedTokens = asRecord(root.tokens);
  if (nestedTokens) {
    const tokenFromNested = getStringField(nestedTokens, ['access_token', 'accessToken', 'token']);
    if (tokenFromNested) {
      return {
        token: tokenFromNested,
        account: getStringField(nestedTokens, ['account_id', 'accountId', 'email']),
        updatedAt: getStringField(root, ['last_refresh', 'updatedAt']),
        expiresAt: getStringField(nestedTokens, ['expires_at', 'expiresAt']),
      };
    }
  }

  const directToken = getStringField(root, ['access_token', 'accessToken', 'token']);
  if (directToken) {
    return {
      token: directToken,
      account: getStringField(root, ['account_id', 'accountId', 'email']),
      updatedAt: getStringField(root, ['last_refresh', 'updatedAt']),
      expiresAt: getStringField(root, ['expires_at', 'expiresAt']),
    };
  }

  const profiles = asRecord(root.profiles);
  if (!profiles) {
    return null;
  }

  const defaultProfile = typeof root.default_profile === 'string' ? root.default_profile : undefined;
  const profileEntries = Object.entries(profiles);
  if (profileEntries.length === 0) {
    return null;
  }

  const prioritizedEntries = defaultProfile
    ? [
        ...profileEntries.filter(([name]) => name === defaultProfile),
        ...profileEntries.filter(([name]) => name !== defaultProfile),
      ]
    : profileEntries;

  for (const [profileName, profileValue] of prioritizedEntries) {
    const profile = asRecord(profileValue);
    if (!profile) {
      continue;
    }
    const token = getStringField(profile, ['access_token', 'accessToken', 'token']);
    if (!token) {
      continue;
    }
    return {
      token,
      profile: profileName,
      account: getStringField(profile, ['account_id', 'accountId', 'email']),
      updatedAt: getStringField(profile, ['last_refresh', 'updatedAt']),
      expiresAt: getStringField(profile, ['expires_at', 'expiresAt']),
    };
  }

  return null;
}

export function parseClaudeAuthPayload(payload: unknown): ParsedToken | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }

  const oauth = asRecord(root.claudeAiOauth) ?? asRecord(root.oauth) ?? asRecord(root.auth);
  const target = oauth || root;
  const token = getStringField(target, ['accessToken', 'access_token', 'token']);
  if (!token) {
    return null;
  }

  return {
    token,
    account: getStringField(target, ['email', 'account_id', 'accountId']),
    expiresAt: getStringField(target, ['expiresAt', 'expires_at']),
    updatedAt: getStringField(target, ['updatedAt', 'updated_at', 'lastRefresh']),
  };
}

function readCodexToken(): ImportedLocalAuthToken | null {
  const parsed = parseCodexAuthPayload(readJsonFile(CODEX_AUTH_PATH));
  if (!parsed) {
    return null;
  }
  return {
    provider: 'codex',
    path: CODEX_AUTH_PATH,
    ...parsed,
  };
}

function readClaudeToken(): ImportedLocalAuthToken | null {
  const parsed = parseClaudeAuthPayload(readJsonFile(CLAUDE_AUTH_PATH));
  if (!parsed) {
    return null;
  }
  return {
    provider: 'claude',
    path: CLAUDE_AUTH_PATH,
    ...parsed,
  };
}

export function getLocalAuthStatuses(): LocalAuthStatus[] {
  const codex = readCodexToken();
  const claude = readClaudeToken();
  return [
    codex
      ? {
          provider: 'codex',
          available: true,
          path: codex.path,
          profile: codex.profile,
          account: codex.account,
          expiresAt: codex.expiresAt,
          updatedAt: codex.updatedAt,
        }
      : { provider: 'codex', available: false, path: CODEX_AUTH_PATH },
    claude
      ? {
          provider: 'claude',
          available: true,
          path: claude.path,
          account: claude.account,
          expiresAt: claude.expiresAt,
          updatedAt: claude.updatedAt,
        }
      : { provider: 'claude', available: false, path: CLAUDE_AUTH_PATH },
  ];
}

export function importLocalAuthToken(provider: LocalAuthProvider): ImportedLocalAuthToken | null {
  return provider === 'codex' ? readCodexToken() : readClaudeToken();
}
