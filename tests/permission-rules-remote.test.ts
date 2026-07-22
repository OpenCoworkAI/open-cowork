import { beforeEach, describe, expect, it } from 'vitest';
import {
  decidePermission,
  forgetSessionPermissions,
  isRemoteSession,
  markSessionRemote,
  rememberAlwaysAllow,
  setPermissionRules,
} from '../src/main/config/permission-rules-store';

describe('remote session permission tier (issue #311 phase 1)', () => {
  beforeEach(() => {
    setPermissionRules(null); // restore defaults
    forgetSessionPermissions('remote-s');
    forgetSessionPermissions('local-s');
  });

  it('marks and reports remote sessions', () => {
    markSessionRemote('remote-s');
    expect(isRemoteSession('remote-s')).toBe(true);
    expect(isRemoteSession('local-s')).toBe(false);
  });

  it('escalates read-class allows to ask for remote sessions only', () => {
    markSessionRemote('remote-s');
    for (const tool of ['read', 'glob', 'grep', 'ls', 'find']) {
      expect(decidePermission('local-s', tool, {})).toBe('allow');
      expect(decidePermission('remote-s', tool, {})).toBe('ask');
    }
  });

  it('keeps write/bash at ask for both origins', () => {
    markSessionRemote('remote-s');
    expect(decidePermission('remote-s', 'bash', {})).toBe('ask');
    expect(decidePermission('local-s', 'bash', {})).toBe('ask');
  });

  it('denies GUI-operate tools outright for remote sessions, even with a grant', () => {
    markSessionRemote('remote-s');
    const guiTool = 'mcp__gui-operate__mouse_click__ab12';
    expect(decidePermission('remote-s', guiTool, {})).toBe('deny');
    rememberAlwaysAllow('remote-s', guiTool);
    expect(decidePermission('remote-s', guiTool, {})).toBe('deny');
    // Local sessions keep the family-grant behavior.
    rememberAlwaysAllow('local-s', guiTool);
    expect(decidePermission('local-s', 'mcp__gui-operate__keyboard_type__cd34', {})).toBe('allow');
  });

  it('honors owner-granted always-allow for remote read tools', () => {
    markSessionRemote('remote-s');
    rememberAlwaysAllow('remote-s', 'read');
    expect(decidePermission('remote-s', 'read', {})).toBe('allow');
  });
});
