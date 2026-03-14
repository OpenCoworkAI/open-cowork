/**
 * Storage utilities for the progress tracker.
 * Uses chrome.storage.local for persistent data.
 */

const STORAGE_KEYS = {
  ACTIVITIES: 'oc_activities',
  DAILY_SUMMARY: 'oc_daily_summary',
  SETTINGS: 'oc_settings',
  GOALS: 'oc_goals',
  SYNC_QUEUE: 'oc_sync_queue',
};

/**
 * Get today's date key in YYYY-MM-DD format.
 */
export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get activities for a specific date.
 * @param {string} [dateKey] - Date in YYYY-MM-DD format, defaults to today
 * @returns {Promise<Array>} List of activity entries
 */
export async function getActivities(dateKey) {
  const key = `${STORAGE_KEYS.ACTIVITIES}_${dateKey || todayKey()}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

/**
 * Save an activity entry.
 * @param {object} activity - Activity to save
 */
export async function saveActivity(activity) {
  const key = `${STORAGE_KEYS.ACTIVITIES}_${todayKey()}`;
  const activities = await getActivities();
  activities.push(activity);
  await chrome.storage.local.set({ [key]: activities });
  await addToSyncQueue(activity);
}

/**
 * Update the last activity entry (e.g., to update duration).
 * @param {function} updater - Function that receives and returns the activity
 */
export async function updateLastActivity(updater) {
  const key = `${STORAGE_KEYS.ACTIVITIES}_${todayKey()}`;
  const activities = await getActivities();
  if (activities.length > 0) {
    activities[activities.length - 1] = updater(activities[activities.length - 1]);
    await chrome.storage.local.set({ [key]: activities });
  }
}

/**
 * Get the daily summary for a specific date.
 * @param {string} [dateKey] - Date key, defaults to today
 * @returns {Promise<object>} Daily summary
 */
export async function getDailySummary(dateKey) {
  const key = `${STORAGE_KEYS.DAILY_SUMMARY}_${dateKey || todayKey()}`;
  const result = await chrome.storage.local.get(key);
  return result[key] || {
    date: dateKey || todayKey(),
    totalTime: 0,
    categoryBreakdown: {},
    topSites: [],
    sessionsCount: 0,
    focusScore: 0,
  };
}

/**
 * Save the daily summary.
 * @param {object} summary - Summary data
 * @param {string} [dateKey] - Date key, defaults to today
 */
export async function saveDailySummary(summary, dateKey) {
  const key = `${STORAGE_KEYS.DAILY_SUMMARY}_${dateKey || todayKey()}`;
  await chrome.storage.local.set({ [key]: summary });
}

/**
 * Get user settings.
 * @returns {Promise<object>} Settings
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return result[STORAGE_KEYS.SETTINGS] || {
    trackingEnabled: true,
    idleThresholdMinutes: 5,
    excludedDomains: [],
    coeadaptApiUrl: '',
    coeadaptApiKey: '',
    syncEnabled: false,
    desktopApiUrl: 'http://localhost:3777',
    dailyGoalMinutes: 480,
    categories: {},
  };
}

/**
 * Save user settings.
 * @param {object} settings
 */
export async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * Get career goals.
 * @returns {Promise<Array>} Goals
 */
export async function getGoals() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.GOALS);
  return result[STORAGE_KEYS.GOALS] || [];
}

/**
 * Save career goals.
 * @param {Array} goals
 */
export async function saveGoals(goals) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GOALS]: goals });
}

/**
 * Add item to sync queue (for Coeadapt integration).
 * @param {object} item
 */
export async function addToSyncQueue(item) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_QUEUE);
  const queue = result[STORAGE_KEYS.SYNC_QUEUE] || [];
  queue.push({ ...item, queuedAt: Date.now() });
  // Keep queue manageable
  const trimmed = queue.slice(-500);
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_QUEUE]: trimmed });
}

/**
 * Get and clear the sync queue.
 * @returns {Promise<Array>} Queued items
 */
export async function drainSyncQueue() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_QUEUE);
  const queue = result[STORAGE_KEYS.SYNC_QUEUE] || [];
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_QUEUE]: [] });
  return queue;
}

/**
 * Get all date keys that have stored activities.
 * @returns {Promise<string[]>} List of date keys
 */
export async function getActivityDateKeys() {
  const all = await chrome.storage.local.get(null);
  const prefix = `${STORAGE_KEYS.ACTIVITIES}_`;
  return Object.keys(all)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort()
    .reverse();
}

/**
 * Clean up old data (keep last 30 days).
 */
export async function cleanupOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const all = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(all).filter((k) => {
    const match = k.match(/_(\d{4}-\d{2}-\d{2})$/);
    return match && match[1] < cutoffKey;
  });

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}
