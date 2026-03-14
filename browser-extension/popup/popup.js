/**
 * Open Cowork - Popup UI Controller
 *
 * Renders daily/weekly progress data and manages goals.
 */

import { CATEGORIES, getCategoryInfo } from '../lib/categories.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupTrackingToggle();
  setupGoalModal();
  setupSettings();

  await refreshAll();

  // Refresh current activity every second
  setInterval(refreshCurrent, 1000);
  // Refresh summary every 30 seconds
  setInterval(refreshSummary, 30000);
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function setupTabs() {
  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      $$('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'week') refreshWeekly();
      if (tab.dataset.tab === 'goals') refreshGoals();
    });
  }
}

// ---------------------------------------------------------------------------
// Tracking toggle
// ---------------------------------------------------------------------------

function setupTrackingToggle() {
  const btn = $('#toggleTracking');
  btn.addEventListener('click', async () => {
    const { settings } = await sendMessage({ type: 'GET_SETTINGS' });
    const newState = !settings.trackingEnabled;
    await sendMessage({ type: 'TOGGLE_TRACKING', enabled: newState });
    updateTrackingButton(newState);
  });
}

function updateTrackingButton(enabled) {
  const btn = $('#toggleTracking');
  const icon = $('#trackingIcon');
  if (enabled) {
    icon.innerHTML = '&#9654;'; // play
    btn.className = 'btn-icon active';
    btn.title = 'Tracking active - click to pause';
  } else {
    icon.innerHTML = '&#9646;&#9646;'; // pause
    btn.className = 'btn-icon paused';
    btn.title = 'Tracking paused - click to resume';
  }
}

// ---------------------------------------------------------------------------
// Settings button
// ---------------------------------------------------------------------------

function setupSettings() {
  $('#openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

// ---------------------------------------------------------------------------
// Refresh all data
// ---------------------------------------------------------------------------

async function refreshAll() {
  const [settingsResp] = await Promise.all([
    sendMessage({ type: 'GET_SETTINGS' }),
  ]);
  updateTrackingButton(settingsResp.settings.trackingEnabled);

  // Check sync status
  const syncStatus = $('#syncStatus');
  if (settingsResp.settings.syncEnabled && settingsResp.settings.coeadaptApiUrl) {
    syncStatus.textContent = 'Synced';
    syncStatus.classList.add('synced');
  }

  await Promise.all([refreshSummary(), refreshCurrent()]);
}

// ---------------------------------------------------------------------------
// Current activity
// ---------------------------------------------------------------------------

async function refreshCurrent() {
  const { current, isIdle } = await sendMessage({ type: 'GET_CURRENT' });

  const titleEl = $('#currentTitle');
  const durationEl = $('#currentDuration');
  const iconEl = $('#currentIcon');

  if (!current || isIdle) {
    titleEl.textContent = isIdle ? 'Idle' : 'No activity';
    durationEl.textContent = '--';
    iconEl.textContent = isIdle ? '💤' : '--';
    return;
  }

  const cat = getCategoryInfo(current.category);
  iconEl.textContent = cat.icon;
  titleEl.textContent = current.title || current.hostname || 'Browsing';
  durationEl.textContent = formatDuration(current.liveDuration);
}

// ---------------------------------------------------------------------------
// Daily summary
// ---------------------------------------------------------------------------

async function refreshSummary() {
  const { summary } = await sendMessage({ type: 'GET_SUMMARY' });
  if (!summary) return;

  // Focus score
  $('#focusScore').textContent = summary.focusScore;
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (summary.focusScore / 100) * circumference;
  $('#focusRing').style.strokeDashoffset = offset;

  // Color the ring based on score
  const ring = $('#focusRing');
  if (summary.focusScore >= 70) ring.style.stroke = 'var(--accent-green)';
  else if (summary.focusScore >= 40) ring.style.stroke = 'var(--accent-yellow)';
  else ring.style.stroke = 'var(--accent-red)';

  // Stats
  $('#totalTime').textContent = formatDurationShort(summary.totalTime);
  $('#sessionsCount').textContent = summary.sessionsCount;

  // Category breakdown
  renderCategoryBreakdown(summary.categoryBreakdown, summary.totalTime);

  // Top sites
  renderTopSites(summary.topSites);

  // Last update
  $('#lastUpdate').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function renderCategoryBreakdown(breakdown, totalTime) {
  const container = $('#categoryBreakdown');
  const entries = Object.entries(breakdown)
    .filter(([, time]) => time > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">No activity tracked yet</div>';
    return;
  }

  container.innerHTML = entries
    .map(([catId, time]) => {
      const cat = getCategoryInfo(catId);
      const pct = totalTime > 0 ? Math.round((time / totalTime) * 100) : 0;
      return `
        <div class="category-item">
          <div class="category-dot" style="background: ${cat.color}"></div>
          <span class="category-name">${cat.icon} ${cat.label}</span>
          <span class="category-time">${formatDurationShort(time)}</span>
          <div class="category-bar-container">
            <div class="category-bar" style="width: ${pct}%; background: ${cat.color}"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderTopSites(sites) {
  const container = $('#topSites');
  if (!sites || sites.length === 0) {
    container.innerHTML = '<div class="empty-state">No sites visited yet</div>';
    return;
  }

  container.innerHTML = sites
    .slice(0, 5)
    .map(
      (s, i) => `
      <div class="site-item">
        <span class="site-rank">${i + 1}</span>
        <span class="site-name">${s.hostname}</span>
        <span class="site-time">${formatDurationShort(s.time)}</span>
      </div>
    `
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

async function refreshWeekly() {
  const { weekly } = await sendMessage({ type: 'GET_WEEKLY_SUMMARY' });
  if (!weekly) return;

  const chart = $('#weekChart');
  const maxTime = Math.max(...weekly.days.map((d) => d.totalTime || 0), 1);
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayIdx = new Date().getDay();

  chart.innerHTML = weekly.days
    .map((day, i) => {
      const height = day.totalTime > 0 ? Math.max((day.totalTime / maxTime) * 100, 4) : 2;
      const dayOfWeek = new Date(day.date + 'T12:00:00').getDay();
      const isToday = i === weekly.days.length - 1;
      const label = dayLabels[dayOfWeek] || '?';
      const timeLabel = day.totalTime > 0 ? formatDurationShort(day.totalTime) : '';
      return `
        <div class="week-bar-wrapper">
          <div class="week-bar-track">
            <div class="week-bar-value">${timeLabel}</div>
            <div class="week-bar ${isToday ? 'today' : ''}" style="height: ${height}%"></div>
          </div>
          <span class="week-bar-label">${label}</span>
        </div>
      `;
    })
    .join('');

  $('#weekTotal').textContent = `${weekly.totalTimeHours}h`;
  $('#weekAvgFocus').textContent = `${weekly.avgFocusScore}%`;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function setupGoalModal() {
  $('#addGoal').addEventListener('click', () => {
    $('#addGoalModal').classList.remove('hidden');
  });

  $('#cancelGoal').addEventListener('click', () => {
    $('#addGoalModal').classList.add('hidden');
  });

  $('#saveGoal').addEventListener('click', async () => {
    const title = $('#goalTitle').value.trim();
    const category = $('#goalCategory').value;
    const targetHours = parseInt($('#goalTarget').value, 10);

    if (!title || !targetHours) return;

    const result = await chrome.storage.local.get('oc_goals');
    const goals = result.oc_goals || [];
    goals.push({
      id: crypto.randomUUID(),
      title,
      category,
      targetHours,
      createdAt: Date.now(),
    });
    await chrome.storage.local.set({ oc_goals: goals });

    // Reset form
    $('#goalTitle').value = '';
    $('#goalTarget').value = '';
    $('#addGoalModal').classList.add('hidden');

    await refreshGoals();
  });
}

async function refreshGoals() {
  const result = await chrome.storage.local.get('oc_goals');
  const goals = result.oc_goals || [];
  const container = $('#goalsList');

  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state">Set career development goals to track your progress</div>';
    return;
  }

  // Get weekly time by category
  const { weekly } = await sendMessage({ type: 'GET_WEEKLY_SUMMARY' });
  const categoryTotals = {};
  if (weekly) {
    for (const day of weekly.days) {
      for (const [cat, time] of Object.entries(day.categoryBreakdown || {})) {
        categoryTotals[cat] = (categoryTotals[cat] || 0) + time;
      }
    }
  }

  container.innerHTML = goals
    .map((goal) => {
      const spent = categoryTotals[goal.category] || 0;
      const spentHours = Math.round((spent / 3600000) * 10) / 10;
      const pct = Math.min(Math.round((spentHours / goal.targetHours) * 100), 100);
      const cat = getCategoryInfo(goal.category);

      return `
        <div class="goal-item" data-goal-id="${goal.id}">
          <div class="goal-header">
            <span class="goal-title">${cat.icon} ${escapeHtml(goal.title)}</span>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="goal-progress-text">${spentHours}h / ${goal.targetHours}h</span>
              <button class="goal-delete" data-id="${goal.id}" title="Delete goal">&times;</button>
            </div>
          </div>
          <div class="goal-bar-container">
            <div class="goal-bar" style="width: ${pct}%; background: ${cat.color}"></div>
          </div>
          <div class="goal-category">${cat.label} - ${pct}% this week</div>
        </div>
      `;
    })
    .join('');

  // Delete handlers
  for (const btn of container.querySelectorAll('.goal-delete')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const r = await chrome.storage.local.get('oc_goals');
      const updated = (r.oc_goals || []).filter((g) => g.id !== id);
      await chrome.storage.local.set({ oc_goals: updated });
      await refreshGoals();
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatDurationShort(ms) {
  if (!ms || ms < 0) return '0m';
  const min = Math.floor(ms / 60000);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  return `${min}m`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
