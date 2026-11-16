import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { GatewayControlCard } from '../../renderer/components/remote/GatewayControlCard';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('remote gateway toggle after removing credentials', () => {
  it.each([
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [true, true, false],
  ])('running=%s credentials=%s disabled=%s', (running, credentials, disabled) => {
    let tree: ReactTestRenderer;
    act(() => {
      tree = create(
        React.createElement(GatewayControlCard, {
          status: { running, activeSessions: 0, pendingPairings: 0, channels: [] },
          pairedUsers: [],
          pendingPairings: [],
          isTogglingGateway: false,
          canStartGateway: credentials,
          onToggle: () => {},
        })
      );
    });
    try {
      expect(tree!.root.findByType('button').props.disabled).toBe(disabled);
    } finally {
      act(() => tree!.unmount());
    }
  });
});
