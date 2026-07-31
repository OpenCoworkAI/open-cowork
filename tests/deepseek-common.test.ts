import { afterEach, describe, expect, it, vi } from 'vitest';

async function importCommonWithExecFileSync(execFileSync: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('node:child_process', () => ({ execFileSync }));
  return import('../.github/scripts/deepseek-common.mjs');
}

function missingCommandError(command: string): NodeJS.ErrnoException {
  const error = new Error(`spawnSync ${command} ENOENT`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

describe('deepseek-common runRg', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('falls back to git grep when ripgrep is not installed', async () => {
    const execFileSync = vi.fn((command: string, args: string[]) => {
      if (command === 'rg') {
        throw missingCommandError('rg');
      }
      if (command === 'git') {
        expect(args).toEqual([
          'grep',
          '-n',
          '-F',
          '--max-count',
          '2',
          '-e',
          'Roadmap',
          '--',
          ':!node_modules/**',
          '.',
        ]);
        return 'ROADMAP.md:1:# Open Cowork Roadmap\n';
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const { runRg } = await importCommonWithExecFileSync(execFileSync);

    expect(
      runRg(['-n', '-F', '--max-count', '2', '-e', 'Roadmap', '--glob', '!node_modules/**', '.'])
    ).toBe('ROADMAP.md:1:# Open Cowork Roadmap');
  });

  it('returns no snippets when ripgrep and git grep are both unavailable', async () => {
    const execFileSync = vi.fn((command: string) => {
      throw missingCommandError(command);
    });

    const { runRg } = await importCommonWithExecFileSync(execFileSync);

    expect(runRg(['-n', '-F', '-e', 'Roadmap', '.'])).toBe('');
  });
});

describe('deepseek-common PR review history', () => {
  it('accepts a linear update whose merge base is the previously reviewed head', async () => {
    const { isLinearReviewUpdate } = await import('../.github/scripts/deepseek-common.mjs');

    expect(
      isLinearReviewUpdate(
        {
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
          merge_base_sha: 'previous-head',
          commit_count: 2,
          has_merge_commit: false,
        },
        'previous-head'
      )
    ).toBe(true);
  });

  it('rejects a diverged comparison after a force-push or rebase', async () => {
    const { isLinearReviewUpdate } = await import('../.github/scripts/deepseek-common.mjs');

    expect(
      isLinearReviewUpdate(
        {
          status: 'diverged',
          ahead_by: 13,
          behind_by: 7,
          merge_base_sha: 'older-common-base',
          commit_count: 13,
          has_merge_commit: false,
        },
        'previous-head'
      )
    ).toBe(false);
  });

  it('rejects an ahead comparison when the previous head is not the merge base', async () => {
    const { isLinearReviewUpdate } = await import('../.github/scripts/deepseek-common.mjs');

    expect(
      isLinearReviewUpdate(
        {
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
          merge_base_sha: 'different-head',
          commit_count: 2,
          has_merge_commit: false,
        },
        'previous-head'
      )
    ).toBe(false);
  });

  it('rejects a linear-looking range that merged another branch', async () => {
    const { isLinearReviewUpdate } = await import('../.github/scripts/deepseek-common.mjs');

    expect(
      isLinearReviewUpdate(
        {
          status: 'ahead',
          ahead_by: 2,
          behind_by: 0,
          merge_base_sha: 'previous-head',
          commit_count: 2,
          has_merge_commit: true,
        },
        'previous-head'
      )
    ).toBe(false);
  });

  it('rejects an incomplete compare response that could hide a merge commit', async () => {
    const { isLinearReviewUpdate } = await import('../.github/scripts/deepseek-common.mjs');

    expect(
      isLinearReviewUpdate(
        {
          status: 'ahead',
          ahead_by: 251,
          behind_by: 0,
          merge_base_sha: 'previous-head',
          commit_count: 250,
          has_merge_commit: false,
        },
        'previous-head'
      )
    ).toBe(false);
  });
});

describe('deepseek-common PR file pagination', () => {
  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.resetModules();
  });

  it('combines every page of the current PR file list', async () => {
    const execFileSync = vi.fn((command: string, args: string[]) => {
      expect(command).toBe('gh');
      expect(args).toEqual([
        'api',
        '--paginate',
        '--slurp',
        'repos/OpenCoworkAI/open-cowork/pulls/298/files?per_page=100',
      ]);
      return '[[{"filename":"first.ts"}],[{"filename":"second.ts"}]]';
    });
    const { listPullRequestFiles } = await importCommonWithExecFileSync(execFileSync);

    expect(listPullRequestFiles('OpenCoworkAI/open-cowork', '298')).toEqual([
      { filename: 'first.ts' },
      { filename: 'second.ts' },
    ]);
  });
});

describe('deepseek-common structured response parsing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses reasoning_content when DeepSeek returns an empty content field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '',
                reasoning_content: '{"body":"No findings.\\n\\n*Open Cowork Bot*"}',
                role: 'assistant',
              },
            },
          ],
          usage: { completion_tokens: 128 },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { callDeepSeekJson } = await import('../.github/scripts/deepseek-common.mjs');

    const result = await callDeepSeekJson({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      effort: 'high',
      model: 'deepseek-v4-flash',
      systemPrompt: 'Review the pull request.',
      userPrompt: 'Return JSON.',
    });

    expect(result.parsed).toEqual({
      body: 'No findings.\n\n*Open Cowork Bot*',
    });
    expect(result.content).toContain('No findings.');
  });

  it('extracts the final JSON object from reasoning prose', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                reasoning_content: [
                  'I should return an object such as {"example":true}.',
                  'The review is complete.',
                  '{"body":"Review mode: initial\\n\\nNo findings."}',
                ].join('\n'),
                role: 'assistant',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { callDeepSeekJson } = await import('../.github/scripts/deepseek-common.mjs');

    const result = await callDeepSeekJson({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com',
      effort: 'high',
      model: 'deepseek-v4-flash',
      systemPrompt: 'Review the pull request.',
      userPrompt: 'Return JSON.',
    });

    expect(result.parsed).toEqual({
      body: 'Review mode: initial\n\nNo findings.',
    });
  });

  it('raises the output token budget only after an invalid structured response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  reasoning_content: 'Analysis was truncated before the final JSON object.',
                  role: 'assistant',
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  reasoning_content: '{"body":"No findings."}',
                  role: 'assistant',
                },
              },
            ],
          }),
          { status: 200 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { callDeepSeekJsonWithRetries } = await import('../.github/scripts/deepseek-common.mjs');

    await expect(
      callDeepSeekJsonWithRetries({
        apiKey: 'test-key',
        baseUrl: 'https://api.deepseek.com',
        effort: 'high',
        model: 'deepseek-v4-flash',
        systemPrompt: 'Review the pull request.',
        userPrompt: 'Return JSON.',
      })
    ).resolves.toMatchObject({
      parsed: { body: 'No findings.' },
    });

    const requestBodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requestBodies.map((body) => body.max_tokens)).toEqual([8192, 16384]);
  });
});
