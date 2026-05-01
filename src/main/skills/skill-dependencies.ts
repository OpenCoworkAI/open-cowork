import * as fs from 'fs';
import * as path from 'path';
import { logWarn } from '../utils/logger';
import { isPathWithinRoot } from '../tools/path-containment';
import { isSafePythonPackageSpec } from '../utils/python-package-specs';
import { resolveBuiltinSkillsPath } from './skill-paths';

export const SKILL_DEPENDENCIES_FILENAME = 'DEPENDENCIES.json';

export interface SkillDependencyManifest {
  schemaVersion?: 1;
  pythonPackages?: string[];
  nodePackages?: string[];
  systemPackages?: string[];
  optionalPythonPackages?: string[];
  optionalNodePackages?: string[];
  optionalSystemPackages?: string[];
}

export interface SkillDependencySummary {
  pythonPackages: string[];
  nodePackages: string[];
  systemPackages: string[];
  optionalPythonPackages: string[];
  optionalNodePackages: string[];
  optionalSystemPackages: string[];
}

export interface SkillDependencyRoot {
  rootPath: string;
  containmentRoot?: string;
}

function createEmptySummary(): SkillDependencySummary {
  return {
    pythonPackages: [],
    nodePackages: [],
    systemPackages: [],
    optionalPythonPackages: [],
    optionalNodePackages: [],
    optionalSystemPackages: [],
  };
}

function normalizeDependencyList(
  manifest: Record<string, unknown>,
  key: keyof SkillDependencyManifest,
  errors: string[]
): string[] | undefined {
  if (!(key in manifest) || manifest[key] === undefined) {
    return undefined;
  }

  const value = manifest[key];
  if (!Array.isArray(value)) {
    errors.push(`"${key}" must be an array of strings`);
    return undefined;
  }

  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      errors.push(`"${key}" must contain only strings`);
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      errors.push(`"${key}" must not contain empty strings`);
      continue;
    }
    if (
      (key === 'pythonPackages' || key === 'optionalPythonPackages') &&
      !isSafePythonPackageSpec(trimmed)
    ) {
      errors.push(`"${key}" contains unsupported package spec: ${JSON.stringify(trimmed)}`);
      continue;
    }
    normalized.add(trimmed);
  }

  return [...normalized].sort((a, b) => a.localeCompare(b));
}

export const getBuiltinSkillsPath = resolveBuiltinSkillsPath;

export function validateSkillDependencyManifest(manifest: unknown): {
  valid: boolean;
  errors: string[];
  normalized?: SkillDependencyManifest;
} {
  const errors: string[] = [];

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Dependency manifest must be a JSON object'] };
  }

  const record = manifest as Record<string, unknown>;
  const allowedKeys: Array<keyof SkillDependencyManifest> = [
    'schemaVersion',
    'pythonPackages',
    'nodePackages',
    'systemPackages',
    'optionalPythonPackages',
    'optionalNodePackages',
    'optionalSystemPackages',
  ];

  const unexpectedKeys = Object.keys(record).filter(
    (key) => !allowedKeys.includes(key as keyof SkillDependencyManifest)
  );
  if (unexpectedKeys.length > 0) {
    errors.push(`Unexpected key(s): ${unexpectedKeys.sort().join(', ')}`);
  }

  if (
    'schemaVersion' in record &&
    record.schemaVersion !== undefined &&
    record.schemaVersion !== 1
  ) {
    errors.push('"schemaVersion" must be 1 when present');
  }

  const normalized: SkillDependencyManifest = {
    schemaVersion: 1,
    pythonPackages: normalizeDependencyList(record, 'pythonPackages', errors),
    nodePackages: normalizeDependencyList(record, 'nodePackages', errors),
    systemPackages: normalizeDependencyList(record, 'systemPackages', errors),
    optionalPythonPackages: normalizeDependencyList(record, 'optionalPythonPackages', errors),
    optionalNodePackages: normalizeDependencyList(record, 'optionalNodePackages', errors),
    optionalSystemPackages: normalizeDependencyList(record, 'optionalSystemPackages', errors),
  };

  if (
    !normalized.pythonPackages?.length &&
    !normalized.nodePackages?.length &&
    !normalized.systemPackages?.length &&
    !normalized.optionalPythonPackages?.length &&
    !normalized.optionalNodePackages?.length &&
    !normalized.optionalSystemPackages?.length
  ) {
    errors.push('Dependency manifest must declare at least one dependency list');
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true, errors: [], normalized };
}

export function readSkillDependencyManifest(skillPath: string): SkillDependencyManifest | null {
  const manifestPath = path.join(skillPath, SKILL_DEPENDENCIES_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const content = fs.readFileSync(manifestPath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  const validation = validateSkillDependencyManifest(parsed);
  if (!validation.valid || !validation.normalized) {
    throw new Error(validation.errors.join('; '));
  }

  return validation.normalized;
}

export function validateSkillDependencyManifestFile(skillPath: string): string[] {
  const manifestPath = path.join(skillPath, SKILL_DEPENDENCIES_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    return validateSkillDependencyManifest(parsed).errors;
  } catch (error) {
    return [
      `Failed to parse ${SKILL_DEPENDENCIES_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

function mergeIntoSet(target: Set<string>, items?: string[]): void {
  if (!items) {
    return;
  }
  for (const item of items) {
    target.add(item);
  }
}

function shouldUseCaseInsensitiveContainment(rootPath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(rootPath) || rootPath.startsWith('\\\\');
}

function normalizeSkillDependencyRoot(
  root: string | SkillDependencyRoot
): Required<Pick<SkillDependencyRoot, 'rootPath'>> & Pick<SkillDependencyRoot, 'containmentRoot'> {
  return typeof root === 'string' ? { rootPath: root } : { ...root };
}

function isContainedSymlink(skillPath: string, containmentRoot?: string): boolean {
  if (!containmentRoot) {
    return true;
  }

  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(skillPath);
  } catch {
    return false;
  }

  if (!lstat.isSymbolicLink()) {
    return true;
  }

  let realSkillPath: string;
  try {
    realSkillPath = fs.realpathSync(skillPath);
  } catch {
    return false;
  }

  return isPathWithinRoot(
    realSkillPath,
    containmentRoot,
    shouldUseCaseInsensitiveContainment(containmentRoot)
  );
}

export function collectSkillDependencySummary(
  skillRoots: Array<string | SkillDependencyRoot>
): SkillDependencySummary {
  const pythonPackages = new Set<string>();
  const nodePackages = new Set<string>();
  const systemPackages = new Set<string>();
  const optionalPythonPackages = new Set<string>();
  const optionalNodePackages = new Set<string>();
  const optionalSystemPackages = new Set<string>();

  for (const root of skillRoots) {
    const { rootPath, containmentRoot } = normalizeSkillDependencyRoot(root);

    if (!rootPath || !fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      continue;
    }

    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
      const skillPath = path.join(rootPath, entry.name);

      if (!isContainedSymlink(skillPath, containmentRoot)) {
        logWarn(
          `[Skills] Ignoring symlinked skill outside containment root: ${skillPath} -> ${containmentRoot}`
        );
        continue;
      }

      let stat: fs.Stats;
      try {
        // Follow directory symlinks so runtime-linked/global skills contribute
        // their manifests the same way as regular folders.
        stat = fs.statSync(skillPath);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) {
        continue;
      }
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      if (!fs.existsSync(skillMdPath)) {
        continue;
      }

      try {
        const manifest = readSkillDependencyManifest(skillPath);
        if (!manifest) {
          continue;
        }

        mergeIntoSet(pythonPackages, manifest.pythonPackages);
        mergeIntoSet(nodePackages, manifest.nodePackages);
        mergeIntoSet(systemPackages, manifest.systemPackages);
        mergeIntoSet(optionalPythonPackages, manifest.optionalPythonPackages);
        mergeIntoSet(optionalNodePackages, manifest.optionalNodePackages);
        mergeIntoSet(optionalSystemPackages, manifest.optionalSystemPackages);
      } catch (error) {
        logWarn(
          `[Skills] Ignoring invalid ${SKILL_DEPENDENCIES_FILENAME} in ${skillPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return {
    pythonPackages: [...pythonPackages].sort((a, b) => a.localeCompare(b)),
    nodePackages: [...nodePackages].sort((a, b) => a.localeCompare(b)),
    systemPackages: [...systemPackages].sort((a, b) => a.localeCompare(b)),
    optionalPythonPackages: [...optionalPythonPackages].sort((a, b) => a.localeCompare(b)),
    optionalNodePackages: [...optionalNodePackages].sort((a, b) => a.localeCompare(b)),
    optionalSystemPackages: [...optionalSystemPackages].sort((a, b) => a.localeCompare(b)),
  };
}

export function collectBuiltinSkillDependencySummary(): SkillDependencySummary {
  const builtinSkillsPath = getBuiltinSkillsPath();
  if (!builtinSkillsPath) {
    return createEmptySummary();
  }
  return collectSkillDependencySummary([builtinSkillsPath]);
}
