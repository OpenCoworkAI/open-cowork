import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const builtinSkillsRoot = path.resolve(process.cwd(), '.claude', 'skills');

describe('built-in skill portability metadata', () => {
  it('declares compatibility metadata for every built-in skill', () => {
    const entries = fs.readdirSync(builtinSkillsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillMdPath = path.join(builtinSkillsRoot, entry.name, 'SKILL.md');
      expect(fs.existsSync(skillMdPath), `${entry.name} should include SKILL.md`).toBe(true);

      const content = fs.readFileSync(skillMdPath, 'utf8');
      expect(content, `${entry.name} should declare compatibility metadata`).toMatch(
        /^compatibility:\s*["'][^"'\r\n]+["']\s*$/m
      );
    }
  });

  it('ships a dependency manifest for every built-in skill', () => {
    const entries = fs.readdirSync(builtinSkillsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = path.join(builtinSkillsRoot, entry.name, 'DEPENDENCIES.json');
      expect(fs.existsSync(manifestPath), `${entry.name} should include DEPENDENCIES.json`).toBe(
        true
      );
    }
  });

  it('does not hardcode obvious machine-specific absolute user paths', () => {
    const entries = fs.readdirSync(builtinSkillsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillMdPath = path.join(builtinSkillsRoot, entry.name, 'SKILL.md');
      const content = fs.readFileSync(skillMdPath, 'utf8');

      expect(content, `${entry.name} should avoid Windows user profile paths`).not.toMatch(
        /[A-Za-z]:\\Users\\[^\r\n\\]+/m
      );
      expect(content, `${entry.name} should avoid macOS user home paths`).not.toMatch(
        /\/Users\/[^\s/]+/m
      );
    }
  });
});
