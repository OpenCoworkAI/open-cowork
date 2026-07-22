import {
  assertNonEmptyParsedString,
  callDeepSeekJsonWithRetries,
  ensureBotSignature,
  isLinearReviewUpdate,
  loadEventPayload,
  loadPullRequestFileExcerpts,
  loadRepoDocs,
  listPullRequestFiles,
  printUsage,
  readTextFileIfExists,
  requireEnv,
  runGh,
  truncate,
  writeTempJson,
} from './deepseek-common.mjs';

function buildSystemPrompt(basePrompt) {
  return `${basePrompt}

Implementation note:
- You are running through DeepSeek chat completions, not Codex tools.
- Return ONLY valid JSON with the shape {"body":"FULL_MARKDOWN_REVIEW_BODY"}.
- Put every finding directly in the review body itself.
- Do not assume inline review comments are available.
- Treat the authoritative current changed-file list and unified diff as the only
  source of PR-attributed findings. Never carry a prior finding forward unless
  it is re-verified against a currently changed line.
- Keep the markdown body ready to post as a summary-only GitHub PR review.`;
}

function serializeDocs(docs) {
  if (docs.length === 0) {
    return 'No repo docs were found in this checkout.';
  }
  return docs
    .map((doc) => `## ${doc.path}\n${doc.content}`)
    .join('\n\n');
}

function serializeFiles(files) {
  if (files.length === 0) {
    return 'No changed files metadata available.';
  }
  return files
    .map((file) =>
      [
        `### ${file.filename}`,
        `status: ${file.status}`,
        `additions: ${file.additions}`,
        `deletions: ${file.deletions}`,
        file.patch ? truncate(file.patch, 5000, `${file.filename} patch`) : '[no patch available]',
      ].join('\n')
    )
    .join('\n\n');
}

function serializeExcerpts(excerpts) {
  if (excerpts.length === 0) {
    return 'No PR-head file excerpts available.';
  }
  return excerpts
    .map((entry) => `## ${entry.path}\n${entry.content}`)
    .join('\n\n');
}

async function main() {
  const apiKey = requireEnv('DEEPSEEK_API_KEY');
  const baseUrl = requireEnv('DEEPSEEK_BASE_URL');
  const model = requireEnv('DEEPSEEK_MODEL');
  const effort = process.env.DEEPSEEK_EFFORT || 'high';
  const payload = loadEventPayload();
  const prNumber = String(payload.pull_request.number);
  const repo = payload.repository.full_name;
  const currentHeadSha = process.env.CURRENT_HEAD_SHA || payload.pull_request.head.sha;
  const latestBotReviewId = process.env.LATEST_BOT_REVIEW_ID || '';
  const latestBotReviewCommit = process.env.LATEST_BOT_REVIEW_COMMIT || '';
  const isFollowUpReview = process.env.IS_FOLLOW_UP_REVIEW === 'true';
  const priorContextDiscarded = process.env.PRIOR_CONTEXT_DISCARDED === 'true';

  const prompt = readTextFileIfExists('.github/prompts/codex-pr-review.md');
  if (!prompt) {
    throw new Error('Missing .github/prompts/codex-pr-review.md');
  }

  const prMeta = JSON.parse(
    runGh([
      'pr',
      'view',
      prNumber,
      '-R',
      repo,
      '--json',
      'number,title,body,labels,author,additions,deletions,changedFiles,headRefOid,baseRefName,headRefName,url',
    ])
  );
  const diff = runGh(['pr', 'diff', prNumber, '-R', repo]);
  const files = listPullRequestFiles(repo, prNumber);
  const docs = loadRepoDocs(['readme.md', 'ROADMAP.md'], 6000);
  const excerpts = loadPullRequestFileExcerpts(
    prNumber,
    files.map((file) => file.filename),
    6,
    4000
  );

  let reviewModeHint = priorContextDiscarded ? 'full review after prior context reset' : 'initial';
  let followUpContext = priorContextDiscarded
    ? 'Prior review context was discarded because the update was not a safe linear extension. Review only the ' +
      'authoritative current PR diff below.'
    : 'None.';
  if (
    isFollowUpReview &&
    !priorContextDiscarded &&
    latestBotReviewId &&
    latestBotReviewCommit &&
    latestBotReviewCommit !== currentHeadSha
  ) {
    let comparison = null;
    try {
      comparison = JSON.parse(
        runGh([
          'api',
          `repos/${repo}/compare/${latestBotReviewCommit}...${currentHeadSha}`,
          '--jq',
          '{status: .status, ahead_by: .ahead_by, behind_by: .behind_by, merge_base_sha: .merge_base_commit.sha, commit_count: (.commits | length), has_merge_commit: ([.commits[] | select((.parents | length) > 1)] | length > 0)}',
        ])
      );
    } catch (error) {
      console.warn(
        `Could not verify previous review ancestry; using a fresh full review: ${error.message}`
      );
    }

    if (isLinearReviewUpdate(comparison, latestBotReviewCommit)) {
      reviewModeHint = 'follow-up after new commits';
      const review = runGh(['api', `repos/${repo}/pulls/${prNumber}/reviews/${latestBotReviewId}`]);
      const reviewComments = runGh([
        'api',
        `repos/${repo}/pulls/${prNumber}/reviews/${latestBotReviewId}/comments`,
      ]);
      const compareDiff = runGh([
        'api',
        '-H',
        'Accept: application/vnd.github.v3.diff',
        `repos/${repo}/compare/${latestBotReviewCommit}...${currentHeadSha}`,
      ]);
      followUpContext = [
        'Previous bot review from a verified ancestor on a merge-free linear extension:',
        truncate(review, 8000, 'previous review'),
        'Previous bot review comments from that verified ancestor:',
        truncate(reviewComments, 8000, 'previous review comments'),
        `Linear compare diff since previous review:\n${truncate(compareDiff, 20000, 'compare diff')}`,
      ].join('\n\n');
    } else {
      reviewModeHint = 'full review after prior context reset';
      followUpContext =
        'Prior review and old-head compare intentionally omitted: the previously reviewed head ' +
        'is not a verified linear ancestor of the current head (force-push, rebase, merge commit, ' +
        'or incomplete/unavailable history). ' +
        'Review only the authoritative current PR diff below.';
    }
  }

  const userPrompt = [
    `Repo: ${repo}`,
    `PR number: ${prNumber}`,
    `Current head SHA: ${currentHeadSha}`,
    `Review mode hint: ${reviewModeHint}`,
    '',
    'PR metadata:',
    JSON.stringify(prMeta, null, 2),
    '',
    'Repository docs:',
    serializeDocs(docs),
    '',
    'Follow-up context:',
    followUpContext,
    '',
    'AUTHORITATIVE CURRENT PR CHANGED PATHS:',
    files.map((file) => file.filename).join('\n') || '(none)',
    '',
    'Changed files and patches:',
    serializeFiles(files),
    '',
    'PR head file excerpts:',
    serializeExcerpts(excerpts),
    '',
    'Unified diff:',
    truncate(diff, 120000, 'PR diff'),
    '',
    'FINAL SCOPE GUARD:',
    'Report only issues introduced or directly triggered by the authoritative current PR diff. ' +
      'Do not report a prior finding unless its path is listed above and the issue is re-verified ' +
      'on a currently added or modified line.',
  ].join('\n');

  const { parsed, usage } = await callDeepSeekJsonWithRetries({
    apiKey,
    baseUrl,
    model,
    effort,
    systemPrompt: buildSystemPrompt(prompt),
    userPrompt,
  });

  const body = ensureBotSignature(assertNonEmptyParsedString(parsed, 'body'));
  const liveHeadSha = runGh([
    'pr',
    'view',
    prNumber,
    '-R',
    repo,
    '--json',
    'headRefOid',
    '-q',
    '.headRefOid',
  ]);
  if (liveHeadSha !== currentHeadSha) {
    console.log(`PR head moved from ${currentHeadSha} to ${liveHeadSha}; skipping stale review.`);
    return;
  }

  const reviewPayload = writeTempJson('deepseek-pr-review', {
    event: 'COMMENT',
    commit_id: currentHeadSha,
    body,
  });

  runGh(['api', `repos/${repo}/pulls/${prNumber}/reviews`, '--method', 'POST', '--input', reviewPayload]);
  printUsage('DeepSeek PR review', usage);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
