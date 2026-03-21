#!/usr/bin/env node
/**
 * CUA Benchmark Leaderboard — aggregates all benchmark reports into a single view.
 *
 * Usage:
 *   node scripts/cua-leaderboard.mjs              # Print leaderboard
 *   node scripts/cua-leaderboard.mjs --save       # Save to leaderboard.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const BENCHMARKS_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'open-cowork', 'cua-benchmarks',
);

async function loadReports() {
  try {
    const files = await fs.readdir(BENCHMARKS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort();
    const reports = [];

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(BENCHMARKS_DIR, file), 'utf-8');
      const report = parseReport(content, file);
      if (report) reports.push(report);
    }

    return reports;
  } catch {
    return [];
  }
}

function parseReport(content, filename) {
  // Parse variant
  const variantMatch = content.match(/\*\*Variant\*\*:\s*(.+)/);
  const dateMatch = content.match(/\*\*Date\*\*:\s*(.+)/);
  const modelMatch = content.match(/\*\*Model\*\*:\s*(.+)/);
  const overallMatch = content.match(/\*\*Overall\*\*:\s*(\d+)\/(\d+)\s*\((\d+)%\)/);

  if (!overallMatch) return null;

  // Parse task results from table
  const taskLines = content.match(/\| .+ \| \d+ \| \d+% .+ \|/g) || [];
  const tasks = taskLines.map(line => {
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    return {
      name: cols[0],
      tier: parseInt(cols[1]),
      rate: cols[2],
      avgSteps: cols[3],
      avgDuration: cols[4],
    };
  });

  return {
    filename,
    variant: variantMatch?.[1] || 'unknown',
    date: dateMatch?.[1] || 'unknown',
    model: modelMatch?.[1] || 'unknown',
    success: parseInt(overallMatch[1]),
    total: parseInt(overallMatch[2]),
    rate: parseInt(overallMatch[3]),
    tasks,
  };
}

function generateLeaderboard(reports) {
  const lines = [
    '# CUA Benchmark Leaderboard',
    '',
    `*Generated: ${new Date().toISOString()}*`,
    `*Reports: ${reports.length}*`,
    '',
    '## Overall Rankings',
    '',
    '| Rank | Variant | Model | Success Rate | Tasks Won | Date |',
    '|------|---------|-------|-------------|-----------|------|',
  ];

  // Sort by success rate descending, then by date
  const sorted = [...reports].sort((a, b) => b.rate - a.rate || new Date(b.date) - new Date(a.date));

  sorted.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.variant} | ${r.model} | ${r.rate}% (${r.success}/${r.total}) | ${r.tasks.filter(t => !t.rate.startsWith('0%')).length}/${r.tasks.length} | ${r.date.slice(0, 10)} |`);
  });

  // Best result per task
  lines.push('', '## Best Result Per Task', '');

  const taskBests = {};
  for (const report of reports) {
    for (const task of report.tasks) {
      const rateNum = parseInt(task.rate);
      if (!taskBests[task.name] || rateNum > taskBests[task.name].rate) {
        taskBests[task.name] = { rate: rateNum, variant: report.variant, detail: task.rate, date: report.date };
      }
    }
  }

  if (Object.keys(taskBests).length > 0) {
    lines.push('| Task | Best Rate | Best Variant | Date |');
    lines.push('|------|-----------|-------------|------|');
    for (const [name, best] of Object.entries(taskBests)) {
      lines.push(`| ${name} | ${best.detail} | ${best.variant} | ${best.date.slice(0, 10)} |`);
    }
  }

  // Timeline
  lines.push('', '## Progress Timeline', '');
  lines.push('| Date | Variant | Overall | Notes |');
  lines.push('|------|---------|---------|-------|');
  for (const r of sorted.reverse()) {
    lines.push(`| ${r.date.slice(0, 16)} | ${r.variant} | ${r.rate}% | ${r.total} runs |`);
  }

  return lines.join('\n');
}

async function main() {
  const reports = await loadReports();

  if (reports.length === 0) {
    console.error('No benchmark reports found.');
    console.error(`Expected in: ${BENCHMARKS_DIR}`);
    process.exit(0);
  }

  const leaderboard = generateLeaderboard(reports);
  console.log(leaderboard);

  if (process.argv.includes('--save')) {
    const filepath = path.join(BENCHMARKS_DIR, 'LEADERBOARD.md');
    await fs.writeFile(filepath, leaderboard);
    console.error(`Saved to: ${filepath}`);
  }
}

main().catch(e => { console.error('Error:', e); process.exit(1); });
