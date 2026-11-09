/**
 * Tests for the MCP baseline metrics module (Fase 0).
 *
 * The module is the measurement layer that will decide whether the semantic
 * computer-use layer replaces the visual one, so its correctness matters:
 * categories drive the rollout gate, and the duplicate-action counter is a
 * hard gate ("0 retries indevidos").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  classifyMcpErrorKind,
  classifyMcpTool,
  flushMcpMetricsTo,
  getMcpMetricsSnapshot,
  recordMcpToolAttempt,
  resetMcpMetrics,
} from '../src/main/mcp/mcp-metrics';

describe('mcp-metrics', () => {
  beforeEach(() => {
    resetMcpMetrics();
  });

  describe('classifyMcpTool', () => {
    it('classifies GUI Operate vision tools', () => {
      expect(classifyMcpTool('gui_locate_element')).toBe('vision');
      expect(classifyMcpTool('gui_verify_vision')).toBe('vision');
      expect(classifyMcpTool('screenshot')).toBe('vision');
      expect(classifyMcpTool('screenshot_for_display')).toBe('vision');
      expect(classifyMcpTool('gui_extract_info')).toBe('vision');
    });

    it('classifies GUI Operate action tools', () => {
      expect(classifyMcpTool('click')).toBe('action');
      expect(classifyMcpTool('type_text')).toBe('action');
      expect(classifyMcpTool('key_press')).toBe('action');
      expect(classifyMcpTool('scroll')).toBe('action');
      expect(classifyMcpTool('drag')).toBe('action');
    });

    it('classifies agent-desktop action commands as action', () => {
      expect(classifyMcpTool('desktop_click')).toBe('action');
      expect(classifyMcpTool('desktop_double_click')).toBe('action');
      expect(classifyMcpTool('desktop_type')).toBe('action');
      expect(classifyMcpTool('desktop_set_value')).toBe('action');
      expect(classifyMcpTool('desktop_clipboard_set')).toBe('action');
      expect(classifyMcpTool('desktop_close_app')).toBe('action');
    });

    it('classifies agent-desktop observation commands as observation', () => {
      expect(classifyMcpTool('desktop_snapshot')).toBe('observation');
      expect(classifyMcpTool('desktop_find')).toBe('observation');
      expect(classifyMcpTool('desktop_get')).toBe('observation');
      expect(classifyMcpTool('desktop_list_apps')).toBe('observation');
      expect(classifyMcpTool('desktop_skills_get')).toBe('observation');
      expect(classifyMcpTool('desktop_wait')).toBe('observation');
    });

    it('unwraps sanitized mcp__server__tool names', () => {
      expect(classifyMcpTool('mcp__gui-operate__click')).toBe('action');
      expect(classifyMcpTool('mcp__agent-desktop__desktop_snapshot')).toBe('observation');
    });

    it('falls back to other for unknown tools', () => {
      expect(classifyMcpTool('some_unknown_tool')).toBe('other');
      expect(classifyMcpTool('')).toBe('other');
    });
  });

  describe('classifyMcpErrorKind', () => {
    it('detects timeouts', () => {
      expect(classifyMcpErrorKind('Tool call timeout after 300000ms')).toBe('timeout');
    });

    it('detects connection problems', () => {
      expect(classifyMcpErrorKind('MCP server not connected: abc')).toBe('not_connected');
      expect(classifyMcpErrorKind('connection closed')).toBe('connection_closed');
    });

    it('falls back to unknown', () => {
      expect(classifyMcpErrorKind('boom')).toBe('unknown');
    });
  });

  describe('aggregation', () => {
    it('counts logical calls separately from transport attempts', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 100,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.logicalCalls).toBe(1);
      expect(snapshot.totals.transportAttempts).toBe(1);
      expect(snapshot.totals.errors).toBe(0);
      expect(snapshot.tools[0].category).toBe('action');
      expect(snapshot.tools[0].totalDurationMs).toBe(100);
      expect(snapshot.tools[0].maxDurationMs).toBe(100);
    });

    it('counts an error and a timeout', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'gui_locate_element',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 500,
        outcome: 'error',
        errorKind: 'timeout',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.errors).toBe(1);
      expect(snapshot.totals.timeouts).toBe(1);
      expect(snapshot.totals.byCategory.vision.errors).toBe(1);
    });

    it('flags a retry after an uncertain action attempt as duplicate risk', () => {
      // Attempt 1 timed out on an action tool: delivery is unknown.
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 300000,
        outcome: 'error',
        errorKind: 'timeout',
      });
      // Attempt 2 is the transport-level retry.
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 2,
        durationMs: 120,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.uncertainActionAttempts).toBe(1);
      expect(snapshot.totals.retriesAfterUncertainAction).toBe(1);
      expect(snapshot.totals.logicalCalls).toBe(1);
      expect(snapshot.totals.transportAttempts).toBe(2);
    });

    it('does not flag retries after a certain failure', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 10,
        outcome: 'error',
        errorKind: 'not_connected',
      });
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 2,
        durationMs: 10,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.uncertainActionAttempts).toBe(0);
      expect(snapshot.totals.retriesAfterUncertainAction).toBe(0);
    });

    it('does not flag a timeout on an observation tool as uncertain action', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'desktop_snapshot',
        server: 'agent-desktop',
        attempt: 1,
        durationMs: 1000,
        outcome: 'error',
        errorKind: 'timeout',
      });
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'desktop_snapshot',
        server: 'agent-desktop',
        attempt: 2,
        durationMs: 900,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.uncertainActionAttempts).toBe(0);
      expect(snapshot.totals.retriesAfterUncertainAction).toBe(0);
      expect(snapshot.totals.byCategory.observation.timeouts).toBe(1);
    });

    it('treats attempt index 1 as a new logical call', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 10,
        outcome: 'ok',
      });
      recordMcpToolAttempt({
        callId: 'c2',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 10,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.totals.logicalCalls).toBe(2);
      expect(snapshot.totals.transportAttempts).toBe(2);
    });

    it('aggregates per server and tool', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 10,
        outcome: 'ok',
      });
      recordMcpToolAttempt({
        callId: 'c2',
        tool: 'desktop_click',
        server: 'agent-desktop',
        attempt: 1,
        durationMs: 20,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(snapshot.tools).toHaveLength(2);
      expect(snapshot.tools.every((tool) => tool.category === 'action')).toBe(true);
    });

    it('exposes only an allowlisted set of fields per tool (privacy contract)', () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'type_text',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 10,
        outcome: 'ok',
      });

      const snapshot = getMcpMetricsSnapshot();
      expect(Object.keys(snapshot.tools[0]).sort()).toEqual(
        [
          'category',
          'errors',
          'logicalCalls',
          'maxDurationMs',
          'minDurationMs',
          'retriesAfterUncertainAction',
          'server',
          'timeouts',
          'tool',
          'totalDurationMs',
          'transportAttempts',
          'uncertainActionAttempts',
        ].sort()
      );
      expect(Object.keys(snapshot).sort()).toEqual(
        ['startedAt', 'tools', 'totals', 'updatedAt'].sort()
      );
    });
  });

  describe('persistence', () => {
    it('writes a JSON snapshot to the given directory', async () => {
      recordMcpToolAttempt({
        callId: 'c1',
        tool: 'click',
        server: 'gui-operate',
        attempt: 1,
        durationMs: 42,
        outcome: 'ok',
      });

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-metrics-'));
      const filePath = await flushMcpMetricsTo(dir);
      expect(filePath).not.toBeNull();

      const written = JSON.parse(await fs.readFile(filePath as string, 'utf8'));
      expect(written.totals.logicalCalls).toBe(1);
      expect(written.tools[0].tool).toBe('click');

      await fs.rm(dir, { recursive: true, force: true });
    });

    it('returns null instead of throwing when the directory is unwritable', async () => {
      const filePath = await flushMcpMetricsTo(path.join(os.tmpdir(), 'mcp-metrics', '\0invalid'));
      expect(filePath).toBeNull();
    });
  });
});
