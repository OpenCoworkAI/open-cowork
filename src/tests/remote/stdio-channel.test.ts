import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';

/**
 * Tests for src/main/remote/channels/stdio-channel.ts
 */

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-user-data',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    requestSingleInstanceLock: () => true,
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    dock: { setMenu: vi.fn() },
    whenReady: () => Promise.resolve(),
    getName: () => 'test',
    name: 'test',
  },
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  shell: {},
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  Tray: vi.fn(),
}));

// Mock the logger to avoid file I/O
vi.mock('../../main/utils/logger', () => ({
  log: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

describe('StdioChannel', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let originalStdin: typeof process.stdin;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    originalStdin = process.stdin;
  });

  afterEach(() => {
    writeSpy.mockRestore();
    process.stdin = originalStdin;
    vi.resetModules();
  });

  function createMockStdin(): Readable & { isTTY?: boolean } {
    const mockStdin = new Readable({
      read() {},
    });
    (mockStdin as unknown as { isTTY: boolean }).isTTY = false;
    return mockStdin;
  }

  async function getStdioChannel() {
    const { StdioChannel } = await import('../../main/remote/channels/stdio-channel');
    return new StdioChannel();
  }

  describe('start / stop lifecycle', () => {
    it('emits stdio.ready on start', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();

      expect(channel.connected).toBe(true);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('stdio.ready');

      await channel.stop();
      expect(channel.connected).toBe(false);
    });

    it('does not start twice', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      await channel.start(); // second call is a no-op

      // Only one stdio.ready event
      expect(writeSpy).toHaveBeenCalledTimes(1);
      await channel.stop();
    });
  });

  describe('message parsing', () => {
    it('parses valid session.start message', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      const messages: unknown[] = [];
      channel.onMessage((msg) => messages.push(msg));

      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('{"type":"session.start","prompt":"hello"}\n');

      // Allow event loop to process
      await new Promise((r) => setTimeout(r, 10));

      expect(messages).toHaveLength(1);
      const msg = messages[0] as { content: { text: string }; channelType: string };
      expect(msg.content.text).toBe('hello');
      expect(msg.channelType).toBe('stdio');

      await channel.stop();
    });

    it('includes cwd prefix in session.start', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      const messages: unknown[] = [];
      channel.onMessage((msg) => messages.push(msg));

      await channel.start();

      mockStdin.push('{"type":"session.start","prompt":"test","cwd":"/tmp/project"}\n');
      await new Promise((r) => setTimeout(r, 10));

      const msg = messages[0] as { content: { text: string } };
      expect(msg.content.text).toBe('[cwd:/tmp/project] test');

      await channel.stop();
    });

    it('parses session.message', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      const messages: unknown[] = [];
      channel.onMessage((msg) => messages.push(msg));

      await channel.start();

      mockStdin.push('{"type":"session.message","sessionId":"sid-1","text":"continue"}\n');
      await new Promise((r) => setTimeout(r, 10));

      expect(messages).toHaveLength(1);
      const msg = messages[0] as { channelId: string; content: { text: string } };
      expect(msg.channelId).toBe('sid-1');
      expect(msg.content.text).toBe('continue');

      await channel.stop();
    });

    it('parses session.abort as !stop message', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      const messages: unknown[] = [];
      channel.onMessage((msg) => messages.push(msg));

      await channel.start();

      mockStdin.push('{"type":"session.abort","sessionId":"sid-2"}\n');
      await new Promise((r) => setTimeout(r, 10));

      expect(messages).toHaveLength(1);
      const msg = messages[0] as { channelId: string; content: { text: string } };
      expect(msg.channelId).toBe('sid-2');
      expect(msg.content.text).toBe('!stop');

      await channel.stop();
    });
  });

  describe('error handling', () => {
    it('writes error for invalid JSON', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('not valid json\n');
      await new Promise((r) => setTimeout(r, 10));

      expect(writeSpy).toHaveBeenCalled();
      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toContain('Invalid JSON');

      await channel.stop();
    });

    it('writes error for message without type field', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('{"prompt":"hello"}\n');
      await new Promise((r) => setTimeout(r, 10));

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toContain('type');

      await channel.stop();
    });

    it('writes error for unknown message type', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('{"type":"unknown.thing"}\n');
      await new Promise((r) => setTimeout(r, 10));

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toContain('Unknown message type');

      await channel.stop();
    });

    it('writes error for session.start without prompt', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('{"type":"session.start"}\n');
      await new Promise((r) => setTimeout(r, 10));

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toContain('prompt');

      await channel.stop();
    });

    it('writes error for session.message without required fields', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('{"type":"session.message","sessionId":"x"}\n');
      await new Promise((r) => setTimeout(r, 10));

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toContain('sessionId');

      await channel.stop();
    });

    it('ignores empty lines', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      const messages: unknown[] = [];
      channel.onMessage((msg) => messages.push(msg));

      await channel.start();
      writeSpy.mockClear();

      mockStdin.push('\n');
      mockStdin.push('   \n');
      await new Promise((r) => setTimeout(r, 10));

      expect(messages).toHaveLength(0);
      expect(writeSpy).not.toHaveBeenCalled();

      await channel.stop();
    });
  });

  describe('output event writing', () => {
    it('writeSessionStarted writes session.started event', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      channel.writeSessionStarted('sid-abc');

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('session.started');
      expect(output.sessionId).toBe('sid-abc');

      await channel.stop();
    });

    it('writeSessionEnd writes session.end event', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      channel.writeSessionEnd('sid-abc', 'done');

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('session.end');
      expect(output.sessionId).toBe('sid-abc');
      expect(output.result).toBe('done');

      await channel.stop();
    });

    it('writeToolStart writes agent.tool_start event', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      channel.writeToolStart('sid-1', 'Read', { file_path: '/tmp/test.ts' });

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('agent.tool_start');
      expect(output.sessionId).toBe('sid-1');
      expect(output.tool).toBe('Read');
      expect(output.input).toEqual({ file_path: '/tmp/test.ts' });

      await channel.stop();
    });

    it('writeToolEnd writes agent.tool_end event', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      channel.writeToolEnd('sid-1', 'Read', 'file content here');

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('agent.tool_end');
      expect(output.sessionId).toBe('sid-1');
      expect(output.tool).toBe('Read');
      expect(output.output).toBe('file content here');

      await channel.stop();
    });

    it('writeError writes error event', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      channel.writeError('something went wrong', 'sid-1');

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.message).toBe('something went wrong');
      expect(output.sessionId).toBe('sid-1');

      await channel.stop();
    });
  });

  describe('send method (RemoteResponse)', () => {
    it('forwards error replies with replyTo set', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      await channel.send({
        channelType: 'stdio' as 'feishu',
        channelId: 'sid-1',
        replyTo: 'msg-123',
        content: { type: 'text', text: 'An internal error occurred.' },
      });

      const output = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
      expect(output.type).toBe('error');
      expect(output.sessionId).toBe('sid-1');
      expect(output.message).toBe('An internal error occurred.');

      await channel.stop();
    });

    it('ignores responses without replyTo (streaming handled by interceptor)', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      writeSpy.mockClear();

      await channel.send({
        channelType: 'stdio' as 'feishu',
        channelId: 'sid-1',
        content: { type: 'text', text: 'Hello world' },
      });

      // No output — streaming text is handled by stdioEventInterceptor, not send()
      expect(writeSpy).not.toHaveBeenCalled();

      await channel.stop();
    });

    it('does not send when disconnected', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      // Don't start - channel is disconnected
      writeSpy.mockClear();

      await channel.send({
        channelType: 'stdio' as 'feishu',
        channelId: 'sid-1',
        replyTo: 'msg-123',
        content: { type: 'text', text: 'Hello' },
      });

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('graceful shutdown', () => {
    it('handles stdin close gracefully', async () => {
      const mockStdin = createMockStdin();
      Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true });

      const channel = await getStdioChannel();
      await channel.start();
      expect(channel.connected).toBe(true);

      // Simulate stdin close
      mockStdin.push(null);
      await new Promise((r) => setTimeout(r, 10));

      expect(channel.connected).toBe(false);
    });
  });
});
