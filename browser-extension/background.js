/**
 * Open Cowork - Browser Extension Background Service Worker
 *
 * Tracks browser activity for career development progress monitoring.
 * Categorizes time spent across learning, coding, research, career search,
 * and other work activities. Designed to sync with Coeadapt web app.
 */

import { categorizeUrl } from './lib/categories.js';
import {
  getActivities,
  saveActivity,
  updateLastActivity,
  getDailySummary,
  saveDailySummary,
  getSettings,
  drainSyncQueue,
  cleanupOldData,
  todayKey,
} from './lib/storage.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentActivity = null; // { url, title, category, startTime, tabId }
let isIdle = false;
let settings = null;

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  settings = await getSettings();

  // Set up periodic alarms
  chrome.alarms.create('updateSummary', { periodInMinutes: 1 });
  chrome.alarms.create('syncToCoeadapt', { periodInMinutes: 5 });
  chrome.alarms.create('cleanup', { periodInMinutes: 1440 }); // daily

  console.log('[OpenCowork] Extension installed, tracking initialized');
});

chrome.runtime.onStartup.addListener(async () => {
  settings = await getSettings();
  console.log('[OpenCowork] Extension started');
});

// ---------------------------------------------------------------------------
// Tab tracking
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await handleTabChange(tab);
  } catch {
    // Tab may have been closed
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    await handleTabChange(tab);
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await finishCurrentActivity();
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab) {
      await handleTabChange(tab);
    }
  } catch {
    // Window may have been closed
  }
});

/**
 * Handle a tab becoming active or updating.
 */
async function handleTabChange(tab) {
  if (!settings) {
    settings = await getSettings();
  }

  if (!settings.trackingEnabled) return;

  const url = tab.url || '';
  const title = tab.title || '';

  // Skip browser-internal pages
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
      url.startsWith('about:') || url.startsWith('edge://')) {
    await finishCurrentActivity();
    return;
  }

  // Skip excluded domains
  const hostname = safeHostname(url);
  if (settings.excludedDomains?.some((d) => hostname.includes(d))) {
    await finishCurrentActivity();
    return;
  }

  // If same URL as current, no change needed
  if (currentActivity && currentActivity.url === url) return;

  // Finish previous activity
  await finishCurrentActivity();

  // Start new activity
  const category = categorizeUrl(url, title);
  currentActivity = {
    id: crypto.randomUUID(),
    url,
    hostname,
    title,
    category,
    startTime: Date.now(),
    tabId: tab.id,
    date: todayKey(),
  };
}

/**
 * Finalize the current activity and persist it.
 */
async function finishCurrentActivity() {
  if (!currentActivity) return;

  const duration = Date.now() - currentActivity.startTime;

  // Only save activities that lasted at least 2 seconds
  if (duration >= 2000) {
    const activity = {
      ...currentActivity,
      endTime: Date.now(),
      duration,
      durationMinutes: Math.round(duration / 60000 * 10) / 10,
    };
    await saveActivity(activity);
  }

  currentActivity = null;
}

// ---------------------------------------------------------------------------
// Idle detection
// ---------------------------------------------------------------------------

chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === 'idle' || state === 'locked') {
    isIdle = true;
    await finishCurrentActivity();
  } else if (state === 'active') {
    isIdle = false;
    // Resume tracking the active tab
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await handleTabChange(tab);
      }
    } catch {
      // No active tab
    }
  }
});

// Set idle detection threshold
async function updateIdleThreshold() {
  if (!settings) settings = await getSettings();
  const minutes = settings.idleThresholdMinutes || 5;
  chrome.idle.setDetectionInterval(minutes * 60);
}
updateIdleThreshold();

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case 'updateSummary':
      await computeDailySummary();
      break;
    case 'syncToCoeadapt':
      await syncToCoeadapt();
      break;
    case 'cleanup':
      await cleanupOldData();
      break;
  }
});

// ---------------------------------------------------------------------------
// Daily summary computation
// ---------------------------------------------------------------------------

async function computeDailySummary() {
  const date = todayKey();
  const activities = await getActivities(date);

  const categoryBreakdown = {};
  const siteTime = {};
  let totalTime = 0;

  for (const a of activities) {
    const dur = a.duration || 0;
    totalTime += dur;

    categoryBreakdown[a.category] = (categoryBreakdown[a.category] || 0) + dur;

    const host = a.hostname || 'unknown';
    siteTime[host] = (siteTime[host] || 0) + dur;
  }

  // Add currently active entry
  if (currentActivity && !isIdle) {
    const liveDur = Date.now() - currentActivity.startTime;
    totalTime += liveDur;
    categoryBreakdown[currentActivity.category] =
      (categoryBreakdown[currentActivity.category] || 0) + liveDur;
    const host = currentActivity.hostname || 'unknown';
    siteTime[host] = (siteTime[host] || 0) + liveDur;
  }

  // Top sites
  const topSites = Object.entries(siteTime)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([hostname, time]) => ({ hostname, time }));

  // Focus score: ratio of productive categories to total
  const productiveCategories = ['learning', 'coding', 'research', 'writing', 'design', 'project_mgmt'];
  const productiveTime = productiveCategories.reduce(
    (sum, cat) => sum + (categoryBreakdown[cat] || 0), 0
  );
  const focusScore = totalTime > 0 ? Math.round((productiveTime / totalTime) * 100) : 0;

  const summary = {
    date,
    totalTime,
    totalTimeMinutes: Math.round(totalTime / 60000),
    categoryBreakdown,
    topSites,
    sessionsCount: activities.length + (currentActivity ? 1 : 0),
    focusScore,
  };

  await saveDailySummary(summary, date);
  return summary;
}

// ---------------------------------------------------------------------------
// Coeadapt sync
// ---------------------------------------------------------------------------

async function syncToCoeadapt() {
  if (!settings) settings = await getSettings();
  if (!settings.syncEnabled || !settings.coeadaptApiUrl || !settings.coeadaptApiKey) {
    return;
  }

  const queue = await drainSyncQueue();
  if (queue.length === 0) return;

  try {
    const response = await fetch(`${settings.coeadaptApiUrl}/api/v1/progress/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.coeadaptApiKey}`,
      },
      body: JSON.stringify({
        source: 'browser_extension',
        version: chrome.runtime.getManifest().version,
        activities: queue.map((a) => ({
          id: a.id,
          category: a.category,
          hostname: a.hostname,
          title: a.title,
          startTime: a.startTime,
          endTime: a.endTime,
          duration: a.duration,
          date: a.date,
        })),
      }),
    });

    if (!response.ok) {
      console.warn('[OpenCowork] Coeadapt sync failed:', response.status);
    }
  } catch (err) {
    console.warn('[OpenCowork] Coeadapt sync error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Message handling (from popup / options / content script)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_SUMMARY': {
      const summary = await computeDailySummary();
      return { summary };
    }

    case 'GET_ACTIVITIES': {
      const activities = await getActivities(message.dateKey);
      return { activities };
    }

    case 'GET_CURRENT': {
      return {
        current: currentActivity
          ? { ...currentActivity, liveDuration: Date.now() - currentActivity.startTime }
          : null,
        isIdle,
      };
    }

    case 'GET_SETTINGS': {
      const s = await getSettings();
      return { settings: s };
    }

    case 'SAVE_SETTINGS': {
      const { saveSettings } = await import('./lib/storage.js');
      await saveSettings(message.settings);
      settings = message.settings;
      await updateIdleThreshold();
      return { ok: true };
    }

    case 'TOGGLE_TRACKING': {
      if (!settings) settings = await getSettings();
      settings.trackingEnabled = message.enabled;
      const { saveSettings } = await import('./lib/storage.js');
      await saveSettings(settings);
      if (!message.enabled) {
        await finishCurrentActivity();
      }
      return { ok: true, trackingEnabled: settings.trackingEnabled };
    }

    case 'FORCE_SYNC': {
      await syncToCoeadapt();
      return { ok: true };
    }

    case 'GET_WEEKLY_SUMMARY': {
      const weekly = await computeWeeklySummary();
      return { weekly };
    }

    case 'CONTENT_ACTIVITY': {
      // Activity signals from content script
      if (currentActivity && message.tabId === currentActivity.tabId) {
        currentActivity.title = message.title || currentActivity.title;
        if (message.contentSignals) {
          currentActivity.contentSignals = message.contentSignals;
        }
      }
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ---------------------------------------------------------------------------
// Weekly summary
// ---------------------------------------------------------------------------

async function computeWeeklySummary() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const summary = await getDailySummary(key);
    days.push(summary);
  }

  const totalTime = days.reduce((sum, d) => sum + (d.totalTime || 0), 0);
  const avgFocusScore = days.filter((d) => d.totalTime > 0).length > 0
    ? Math.round(
        days.filter((d) => d.totalTime > 0).reduce((sum, d) => sum + d.focusScore, 0) /
        days.filter((d) => d.totalTime > 0).length
      )
    : 0;

  return {
    days,
    totalTime,
    totalTimeHours: Math.round(totalTime / 3600000 * 10) / 10,
    avgFocusScore,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
