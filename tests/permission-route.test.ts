import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/main/utils/logger', () => ({
  log: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { logError } from '../src/main/utils/logger';
import { routePermissionRequestEvent } from '../src/main/remote/permission-route';
import type { ServerEvent } from '../src/renderer/types/index';

function makePermissionEvent(): ServerEvent {
  return {
    type: 'permission.request',
    payload: {
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      toolName: 'bash',
      input: { command: 'ls' },
    },
  };
}

function makeRequest() {
  return {
    sessionId: 'session-1',
    toolUseId: 'tool-1',
    toolName: 'bash',
    input: { command: 'ls' },
  };
}

describe('routePermissionRequestEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards an allow result to the session manager and does not deliver', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => ({ allow: true }));
    const handlePermissionResponse = vi.fn();
    const deliver = vi.fn();
    const event = makePermissionEvent();

    await routePermissionRequestEvent(
      event,
      makeRequest(),
      { handleRemotePermissionRequest, handlePermissionResponse },
      deliver
    );

    expect(handleRemotePermissionRequest).toHaveBeenCalledWith('session-1', 'tool-1', 'bash', {
      command: 'ls',
    });
    expect(handlePermissionResponse).toHaveBeenCalledWith('tool-1', 'allow');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('maps allow + remember to allow_always', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => ({
      allow: true,
      remember: true,
    }));
    const handlePermissionResponse = vi.fn();
    const deliver = vi.fn();

    await routePermissionRequestEvent(
      makePermissionEvent(),
      makeRequest(),
      { handleRemotePermissionRequest, handlePermissionResponse },
      deliver
    );

    expect(handlePermissionResponse).toHaveBeenCalledWith('tool-1', 'allow_always');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('maps a deny result to deny', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => ({ allow: false }));
    const handlePermissionResponse = vi.fn();
    const deliver = vi.fn();

    await routePermissionRequestEvent(
      makePermissionEvent(),
      makeRequest(),
      { handleRemotePermissionRequest, handlePermissionResponse },
      deliver
    );

    expect(handlePermissionResponse).toHaveBeenCalledWith('tool-1', 'deny');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers to the local UI when remote handling returns null', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => null);
    const handlePermissionResponse = vi.fn();
    const deliver = vi.fn();
    const event = makePermissionEvent();

    await routePermissionRequestEvent(
      event,
      makeRequest(),
      { handleRemotePermissionRequest, handlePermissionResponse },
      deliver
    );

    expect(handlePermissionResponse).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(event);
  });

  it('delivers to the local UI when remote handling throws', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => {
      throw new Error('slack api down');
    });
    const handlePermissionResponse = vi.fn();
    const deliver = vi.fn();
    const event = makePermissionEvent();

    await routePermissionRequestEvent(
      event,
      makeRequest(),
      { handleRemotePermissionRequest, handlePermissionResponse },
      deliver
    );

    expect(logError).toHaveBeenCalled();
    expect(handlePermissionResponse).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledWith(event);
  });

  it('delivers when no session manager response handler is available', async () => {
    const handleRemotePermissionRequest = vi.fn(async () => ({ allow: true }));
    const deliver = vi.fn();
    const event = makePermissionEvent();

    await routePermissionRequestEvent(
      event,
      makeRequest(),
      { handleRemotePermissionRequest },
      deliver
    );

    expect(deliver).toHaveBeenCalledWith(event);
  });

  it('delivers when deps are absent', async () => {
    const deliver = vi.fn();
    const event = makePermissionEvent();

    await routePermissionRequestEvent(event, makeRequest(), null, deliver);

    expect(deliver).toHaveBeenCalledWith(event);
  });
});
