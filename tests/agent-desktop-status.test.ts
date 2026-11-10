import { describe, expect, it, vi } from 'vitest';

import {
  parsePermissionsEnvelope,
  readAgentDesktopStatus,
  type AgentDesktopStatusExec,
} from '../src/main/desktop/agent-desktop-status';

function envelope(data: unknown): string {
  return JSON.stringify({ version: '2.6', ok: true, command: 'permissions', data });
}

describe('agent-desktop status', () => {
  describe('parsePermissionsEnvelope', () => {
    it('extrai as permissões do envelope v2.6', () => {
      const permissions = parsePermissionsEnvelope(
        envelope({
          permissions: {
            accessibility: { state: 'granted' },
            automation: { state: 'not_required' },
            screen_recording: { state: 'denied' },
          },
        })
      );

      expect(permissions?.accessibility?.state).toBe('granted');
      expect(permissions?.automation?.state).toBe('not_required');
      expect(permissions?.screen_recording?.state).toBe('denied');
    });

    it('tolera envelope com chaves a mais/menos', () => {
      const permissions = parsePermissionsEnvelope(
        envelope({ permissions: { accessibility: { state: 'granted', extra: 1 } }, other: true })
      );

      expect(permissions?.accessibility?.state).toBe('granted');
      expect(permissions?.automation).toBeUndefined();
    });

    it('devolve undefined para payload não-JSON', () => {
      expect(parsePermissionsEnvelope('not json at all')).toBeUndefined();
    });

    it('devolve undefined quando não há permissões no envelope', () => {
      expect(parsePermissionsEnvelope(envelope({}))).toBeUndefined();
    });

    it('propaga a mensagem de erro quando ok é false', () => {
      expect(() =>
        parsePermissionsEnvelope(
          JSON.stringify({ ok: false, error: { code: 'X', message: 'boom' } })
        )
      ).toThrow('boom');
    });
  });

  describe('readAgentDesktopStatus', () => {
    it('não faz spawn quando não há binário', async () => {
      const exec = vi.fn() as unknown as AgentDesktopStatusExec;

      const status = await readAgentDesktopStatus({
        mode: 'off',
        platform: 'win32',
        exec,
      });

      expect(status).toEqual({ mode: 'off', platform: 'win32', binaryFound: false });
      expect(exec).not.toHaveBeenCalled();
    });

    it('devolve as permissões quando o comando responde bem', async () => {
      const exec: AgentDesktopStatusExec = async () => ({
        stdout: envelope({
          permissions: { accessibility: { state: 'granted' } },
        }),
        stderr: '',
      });

      const status = await readAgentDesktopStatus({
        binaryPath: '/bin/agent-desktop',
        mode: 'mcp+skill',
        platform: 'darwin',
        version: '1.2.0',
        exec,
      });

      expect(status.binaryFound).toBe(true);
      expect(status.version).toBe('1.2.0');
      expect(status.permissions?.accessibility?.state).toBe('granted');
      expect(status.error).toBeUndefined();
    });

    it('reporta erro sem permissões quando a saída não é JSON', async () => {
      const exec: AgentDesktopStatusExec = async () => ({ stdout: 'garbage', stderr: '' });

      const status = await readAgentDesktopStatus({
        binaryPath: '/bin/agent-desktop',
        mode: 'mcp',
        platform: 'linux',
        exec,
      });

      expect(status.binaryFound).toBe(true);
      expect(status.permissions).toBeUndefined();
      expect(status.error).toBeTruthy();
    });

    it('reporta erro quando o envelope vem com ok false', async () => {
      const exec: AgentDesktopStatusExec = async () => ({
        stdout: JSON.stringify({ ok: false, error: { message: 'permission probe failed' } }),
        stderr: '',
      });

      const status = await readAgentDesktopStatus({
        binaryPath: '/bin/agent-desktop',
        mode: 'mcp',
        platform: 'linux',
        exec,
      });

      expect(status.permissions).toBeUndefined();
      expect(status.error).toContain('permission probe failed');
    });

    it('reporta erro quando o processo falha — nunca lança para fora', async () => {
      const exec: AgentDesktopStatusExec = async () => {
        throw new Error('spawn ENOENT');
      };

      const status = await readAgentDesktopStatus({
        binaryPath: '/bin/agent-desktop',
        mode: 'mcp',
        platform: 'linux',
        exec,
      });

      expect(status.binaryFound).toBe(true);
      expect(status.permissions).toBeUndefined();
      expect(status.error).toContain('spawn ENOENT');
    });
  });
});
