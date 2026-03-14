import { describe, expect, it } from 'vitest';
import { eventRequiresSessionManager } from '../src/main/client-event-utils';
import type { ClientEvent } from '../src/renderer/types';

function makeEvent(type: ClientEvent['type']): ClientEvent {
  switch (type) {
    case 'session.start':
      return { type, payload: { title: 'Hello', prompt: 'World' } };
    case 'session.continue':
      return { type, payload: { sessionId: 'session-1', prompt: 'Next' } };
    case 'session.stop':
    case 'session.delete':
    case 'session.getMessages':
    case 'session.getTraceSteps':
      return { type, payload: { sessionId: 'session-1' } };
    case 'session.list':
    case 'settings.update':
    case 'folder.select':
    case 'workdir.get':
      return { type, payload: {} };
    case 'permission.response':
      return { type, payload: { toolUseId: 'tool-1', result: 'allow' } };
    case 'workdir.set':
      return { type, payload: { path: '/tmp/demo' } };
    case 'workdir.select':
      return { type, payload: { currentPath: '/tmp/demo' } };
    default: {
      const exhaustiveCheck: never = type;
      return exhaustiveCheck;
    }
  }
}

describe('eventRequiresSessionManager', () => {
  it('requires a session manager only for session and permission events', () => {
    const requiredTypes: ClientEvent['type'][] = [
      'session.start',
      'session.continue',
      'session.stop',
      'session.delete',
      'session.list',
      'session.getMessages',
      'session.getTraceSteps',
      'permission.response',
    ];

    for (const type of requiredTypes) {
      expect(eventRequiresSessionManager(makeEvent(type))).toBe(true);
    }
  });

  it('allows folder and workdir interactions before session manager is ready', () => {
    const optionalTypes: ClientEvent['type'][] = [
      'settings.update',
      'folder.select',
      'workdir.get',
      'workdir.set',
      'workdir.select',
    ];

    for (const type of optionalTypes) {
      expect(eventRequiresSessionManager(makeEvent(type))).toBe(false);
    }
  });
});
