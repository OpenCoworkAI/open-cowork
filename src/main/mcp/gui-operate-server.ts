/**
 * GUI Operate MCP Server
 * 
 * This MCP server provides GUI automation capabilities for macOS and Windows:
 * - Click (single click, double click, right click)
 * - Type text (keyboard input)
 * - Scroll (mouse wheel scroll)
 * - Screenshot (capture screen or specific display)
 * - Get display information (multi-monitor support)
 * 
 * Multi-display support:
 * - All operations support display_index parameter
 * - Coordinates are automatically adjusted based on display configuration
 * - Display index 0 is the main display, others are secondary displays
 * 
 * Platform-specific tools:
 * - macOS: Uses cliclick (brew install cliclick) and AppleScript
 * - Windows: Uses PowerShell with .NET System.Windows.Forms
 */

// Bootstrap logging - log as early as possible
import { writeMCPLog } from './mcp-logger.js';
writeMCPLog('=== Module Loading Started ===', 'Bootstrap');

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
writeMCPLog('Imported MCP SDK modules', 'Bootstrap');

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
writeMCPLog('Imported Node.js built-in modules', 'Bootstrap');

const execAsync = promisify(exec);

// Detect platform
const PLATFORM = os.platform(); // 'darwin' for macOS, 'win32' for Windows
writeMCPLog(`Platform detected: ${PLATFORM}`, 'Bootstrap');

// Get Open Cowork data directory for persistent storage
// Use platform-appropriate paths:
// - macOS: ~/Library/Application Support/open-cowork
// - Windows: %APPDATA%/open-cowork
const OPEN_COWORK_DATA_DIR = PLATFORM === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'open-cowork')
  : path.join(os.homedir(), 'Library', 'Application Support', 'open-cowork');

// Directory for storing GUI operate files (screenshots, etc.)
const GUI_OPERATE_DIR = path.join(OPEN_COWORK_DATA_DIR, 'gui_operate');
const SCREENSHOTS_DIR = path.join(GUI_OPERATE_DIR, 'screenshots');
const SCREENSHOT_REUSE_WINDOW_MS = 5 * 60_000;

type ScreenshotCacheEntry = {
  displayIndex: number;
  regionKey: string;
  path: string;
  base64Image: string;
  capturedAt: number;
  displayInfo: { width: number; height: number; scaleFactor: number };
};

let lastScreenshotCache: ScreenshotCacheEntry | null = null;
const screenshotRequestCounts = new Map<string, number>();

// ============================================================================
// Click History Tracking for GUI Locate (App-level Persistent Storage)
// ============================================================================

interface ClickHistoryEntry {
  index: number;
  x: number;  // Logical coordinates (runtime, scaled to current display)
  y: number;
  displayIndex: number;
  timestamp: number;
  operation: string; // 'click', 'double_click', 'right_click', etc.
  count: number; // Number of times this coordinate was clicked
  successCount: number; // Number of times this click led to successful operations
}

interface StoredClickHistoryEntry {
  index: number;
  x_normalized: number;  // Normalized coordinates (0-1000, stored on disk)
  y_normalized: number;
  displayIndex: number;
  displayWidth: number;  // Display dimensions when click was recorded
  displayHeight: number;
  timestamp: number;
  operation: string;
  count: number;
  successCount: number; // Number of times this click led to successful operations
}

interface AppClickHistory {
  appName: string;
  lastUpdated: number;
  clicks: StoredClickHistoryEntry[];  // Stored with normalized coordinates
  counter: number;
}

interface DockItemInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Store click history for current session (in-memory cache)
let clickHistory: ClickHistoryEntry[] = [];
let clickHistoryCounter = 0;
let currentAppName: string = '';
let lastClickEntry: ClickHistoryEntry | null = null; // Track the most recent click for success verification

const APP_NAME_ALIAS_GROUPS: string[][] = [
  ['calendar', '日历'],
  ['notes', '备忘录'],
  ['music', '音乐'],
  ['finder', '访达'],
  ['system settings', 'settings', '系统设置'],
  ['ticktick', '滴答清单'],
  ['wechat', '微信'],
  ['trash', '废纸篓'],
  ['chrome', 'google chrome'],
];

// Base directory for storing app-level data
const GUI_APPS_DIR = path.join(OPEN_COWORK_DATA_DIR, 'gui_apps');
const GUI_LAST_APP_FILE = path.join(GUI_APPS_DIR, '_last_app.json');

interface LastAppContext {
  appName: string;
  savedAt: number;
}

let restoreAppContextPromise: Promise<boolean> | null = null;

async function saveLastAppContext(appName: string): Promise<void> {
  try {
    await fs.mkdir(GUI_APPS_DIR, { recursive: true });
    const payload: LastAppContext = { appName, savedAt: Date.now() };
    await fs.writeFile(GUI_LAST_APP_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (error: any) {
    writeMCPLog(`[App Context] Failed to save last app context: ${error.message}`, 'App Init Warning');
  }
}

async function inferMostRecentAppNameFromDisk(): Promise<string | null> {
  try {
    await fs.mkdir(GUI_APPS_DIR, { recursive: true });
    const entries = await fs.readdir(GUI_APPS_DIR, { withFileTypes: true });

    let best: { appDirName: string; lastUpdated: number } | null = null;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const clickHistoryPath = path.join(GUI_APPS_DIR, entry.name, 'click_history.json');

      try {
        const raw = await fs.readFile(clickHistoryPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AppClickHistory> | null;
        const lastUpdated = typeof parsed?.lastUpdated === 'number' ? parsed.lastUpdated : 0;

        if (!best || lastUpdated > best.lastUpdated) {
          best = { appDirName: entry.name, lastUpdated };
        }
      } catch {
        // ignore
      }
    }

    return best?.appDirName ?? null;
  } catch {
    return null;
  }
}

async function restoreLastAppContext(): Promise<boolean> {
  if (currentAppName) return true;
  if (os.platform() !== 'darwin') return false;

  try {
    const data = await fs.readFile(GUI_LAST_APP_FILE, 'utf-8');
    const parsed = JSON.parse(data) as Partial<LastAppContext> | null;
    const appName = typeof parsed?.appName === 'string' ? parsed.appName : '';

    if (!appName) {
      const inferred = await inferMostRecentAppNameFromDisk();
      if (!inferred) return false;
      writeMCPLog(`[App Context] No appName in last-app file. Inferred most recent app: "${inferred}"`, 'App Init Warning');
      await loadClickHistoryForApp(inferred);
      await saveLastAppContext(inferred);
      return true;
    }

    writeMCPLog(`[App Context] Restoring last app context: "${appName}"`, 'App Init');
    await loadClickHistoryForApp(appName);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      // Backward compatibility: if we don't have last-app metadata yet, infer from disk.
      const inferred = await inferMostRecentAppNameFromDisk();
      if (!inferred) return false;
      writeMCPLog(`[App Context] No last-app file found. Inferred most recent app: "${inferred}"`, 'App Init');
      await loadClickHistoryForApp(inferred);
      await saveLastAppContext(inferred);
      return true;
    }
    writeMCPLog(`[App Context] Failed to restore last app context: ${error.message}`, 'App Init Warning');
    return false;
  }
}

async function ensureAppContextRestored(): Promise<boolean> {
  if (currentAppName) return true;
  if (!restoreAppContextPromise) {
    restoreAppContextPromise = restoreLastAppContext();
  }
  const restored = await restoreAppContextPromise;
  // If restore failed and app is still not initialized, allow future retries (e.g. after init_app creates metadata).
  if (!restored && !currentAppName) {
    restoreAppContextPromise = null;
  }
  return restored;
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function compactText(text: string): string {
  return normalizeText(text).replace(/[\s_-]+/g, '');
}

function inferExpectedAppAliasesFromText(text: string): string[] {
  const normalized = normalizeText(text);
  const compact = compactText(text);
  const aliases = new Set<string>();

  for (const group of APP_NAME_ALIAS_GROUPS) {
    const normalizedGroup = group.map(token => normalizeText(token));
    const compactGroup = group.map(token => compactText(token));
    const matched = normalizedGroup.some(token => token && normalized.includes(token))
      || compactGroup.some(token => token && compact.includes(token));

    if (matched) {
      for (const token of normalizedGroup) {
        if (token) aliases.add(token);
      }
      for (const token of compactGroup) {
        if (token) aliases.add(token);
      }
    }
  }

  return Array.from(aliases);
}

function getAliasTokensForAppName(appName: string): string[] {
  const normalizedName = normalizeText(appName);
  const compactName = compactText(appName);
  const tokens = new Set<string>([normalizedName, compactName]);

  for (const group of APP_NAME_ALIAS_GROUPS) {
    const normalizedGroup = group.map(token => normalizeText(token));
    const compactGroup = group.map(token => compactText(token));
    const matched = normalizedGroup.includes(normalizedName) || compactGroup.includes(compactName);
    if (!matched) continue;

    for (const token of normalizedGroup) {
      if (token) tokens.add(token);
    }
    for (const token of compactGroup) {
      if (token) tokens.add(token);
    }
  }

  return Array.from(tokens).filter(token => token && token !== 'null' && token !== 'missingvalue');
}

function scoreDockItemAgainstDescription(itemName: string, description: string): number {
  const normalizedDescription = normalizeText(description);
  const compactDescription = compactText(description);
  const tokens = getAliasTokensForAppName(itemName);
  let bestScore = 0;

  for (const token of tokens) {
    if (token.length < 2) continue;

    if (normalizedDescription.includes(token)) {
      bestScore = Math.max(bestScore, 120 + token.length);
    }

    const compactToken = compactText(token);
    if (compactToken.length >= 2 && compactDescription.includes(compactToken)) {
      bestScore = Math.max(bestScore, 110 + compactToken.length);
    }
  }

  return bestScore;
}

function isDescriptionDockRelated(description: string): boolean {
  const normalized = normalizeText(description);
  return /dock|下边栏|程序坞|底栏/.test(normalized);
}

function isLikelyAppLaunchVerification(question: string): boolean {
  const normalized = normalizeText(question);
  const mentionsApp = /(app|application|应用|程序|软件)/i.test(normalized);
  const mentionsMenuLike = /(menu|菜单|弹窗|popup|面板|widget|小组件|下拉)/i.test(normalized);
  return mentionsApp && !mentionsMenuLike;
}

function appNameMatchesAliases(appName: string, aliases: string[]): boolean {
  const normalizedName = normalizeText(appName);
  const compactName = compactText(appName);

  return aliases.some(alias => {
    const normalizedAlias = normalizeText(alias);
    const compactAlias = compactText(alias);

    return (normalizedAlias && (normalizedName.includes(normalizedAlias) || normalizedAlias.includes(normalizedName)))
      || (compactAlias && (compactName.includes(compactAlias) || compactAlias.includes(compactName)));
  });
}

/**
 * Get the directory path for a specific app
 */
function getAppDirectory(appName: string): string {
  // Sanitize app name for use in directory name
  const sanitizedName = appName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return path.join(GUI_APPS_DIR, sanitizedName);
}

/**
 * Get the file path for storing click history for a specific app
 */
function getAppClickHistoryFilePath(appName: string): string {
  return path.join(getAppDirectory(appName), 'click_history.json');
}

/**
 * Get all visited apps (apps that have directories in gui_apps)
 */
async function getAllVisitedApps(): Promise<string[]> {
  try {
    // Ensure directory exists
    await fs.mkdir(GUI_APPS_DIR, { recursive: true });
    
    // Read all directories in gui_apps
    const entries = await fs.readdir(GUI_APPS_DIR, { withFileTypes: true });
    
    // Filter directories and read their click_history.json to get actual app names
    const actualAppNames: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          // const clickHistoryPath = path.join(GUI_APPS_DIR, entry.name, 'click_history.json');
          // const data = await fs.readFile(clickHistoryPath, 'utf-8');
          // const appHistory: AppClickHistory = JSON.parse(data);
          // if (appHistory.appName) {
          //   actualAppNames.push(appHistory.appName);
          // }
          actualAppNames.push(entry.name);
          writeMCPLog(`[getAllVisitedApps] Found app: ${entry.name}`, 'App List');
        } catch (error) {
          // Skip directories without valid click_history.json
          continue;
        }
      }
    }
    
    writeMCPLog(`[getAllVisitedApps] Found ${actualAppNames.length} visited apps`, 'App List');
    return actualAppNames;
  } catch (error: any) {
    writeMCPLog(`[getAllVisitedApps] Error reading visited apps: ${error.message}`, 'App List Error');
    return [];
  }
}

/**
 * Load click history from disk for a specific app
 * Converts normalized coordinates (0-1000) to current display's logical coordinates
 */
async function loadClickHistoryForApp(appName: string): Promise<void> {
  try {
    // Ensure app directory exists
    const appDir = getAppDirectory(appName);
    await fs.mkdir(appDir, { recursive: true });
    
    const filePath = getAppClickHistoryFilePath(appName);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const appHistory: AppClickHistory = JSON.parse(data);
      
      // Get current display configuration
      const config = await getDisplayConfiguration();
      
      // Convert stored normalized coordinates to current display's logical coordinates
      clickHistory = [];
      for (const storedClick of appHistory.clicks || []) {
        // Find the display for this click
        const display = config.displays.find(d => d.index === storedClick.displayIndex);
        if (!display) {
          writeMCPLog(`[ClickHistory] Display ${storedClick.displayIndex} not found, skipping click #${storedClick.index}`, 'Click History Load Warning');
          continue;
        }
        
        // Convert normalized coordinates (0-1000) to logical coordinates
        // x_normalized and y_normalized are in range [0, 1000]
        // We need to scale them to the current display's dimensions
        const x = Math.round((storedClick.x_normalized / 1000) * display.width);
        const y = Math.round((storedClick.y_normalized / 1000) * display.height);
        
        clickHistory.push({
          index: storedClick.index,
          x: x,
          y: y,
          displayIndex: storedClick.displayIndex,
          timestamp: storedClick.timestamp,
          operation: storedClick.operation,
          count: storedClick.count,
          successCount: storedClick.successCount || 0, // Default to 0 for backward compatibility
        });
        
        writeMCPLog(`[ClickHistory] Loaded click #${storedClick.index}: normalized (${storedClick.x_normalized}, ${storedClick.y_normalized}) → logical (${x}, ${y}) on display ${storedClick.displayIndex} (${display.width}x${display.height})`, 'Click History Load');
      }
      
      clickHistoryCounter = appHistory.counter || 0;
      currentAppName = appName;
      
      writeMCPLog(`[ClickHistory] Loaded ${clickHistory.length} clicks for app "${appName}" from ${filePath}`, 'Click History Load');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, start fresh
        clickHistory = [];
        clickHistoryCounter = 0;
        currentAppName = appName;
        writeMCPLog(`[ClickHistory] No existing history for app "${appName}", starting fresh`, 'Click History Load');
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    writeMCPLog(`[ClickHistory] Error loading history: ${error.message}`, 'Click History Load Error');
    // Fallback to empty history
    clickHistory = [];
    clickHistoryCounter = 0;
    currentAppName = appName;
  }
}

/**
 * Save the latest click to disk for the current app
 * Only updates the most recent click entry, merging if coordinates match
 * By default, this increments the stored click count when merging.
 * Set { incrementCount: false } to persist metadata updates (e.g. successCount) without changing click count.
 */
async function saveLatestClickToHistory(
  latestClick: ClickHistoryEntry,
  options: { incrementCount?: boolean } = {}
): Promise<void> {
  const incrementCount = options.incrementCount !== false;
  if (!currentAppName) {
    writeMCPLog('[ClickHistory] No app initialized, skipping save', 'Click History Save');
    return;
  }
  
  try {
    // Ensure app directory exists
    const appDir = getAppDirectory(currentAppName);
    await fs.mkdir(appDir, { recursive: true });
    
    const filePath = getAppClickHistoryFilePath(currentAppName);
    
    // Read existing history from disk
    let existingHistory: AppClickHistory;
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      existingHistory = JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create new history
        existingHistory = {
          appName: currentAppName,
          lastUpdated: Date.now(),
          clicks: [],
          counter: 0,
        };
      } else {
        throw error;
      }
    }
    
    // Get current display configuration
    const config = await getDisplayConfiguration();
    const display = config.displays.find(d => d.index === latestClick.displayIndex);
    
    if (!display) {
      writeMCPLog(`[ClickHistory] Display ${latestClick.displayIndex} not found, skipping save`, 'Click History Save Warning');
      return;
    }
    
    // Convert logical coordinates to normalized coordinates (0-1000)
    const x_normalized = Math.round((latestClick.x / display.width) * 1000);
    const y_normalized = Math.round((latestClick.y / display.height) * 1000);
    
    // Check if this coordinate already exists in the stored history
    const existingClickIndex = existingHistory.clicks.findIndex(
      click => 
        click.x_normalized === x_normalized && 
        click.y_normalized === y_normalized && 
        click.displayIndex === latestClick.displayIndex
    );
    
    if (existingClickIndex !== -1) {
      // Coordinate exists, merge (optionally incrementing count)
      if (incrementCount) {
        existingHistory.clicks[existingClickIndex].count++;
      }
      existingHistory.clicks[existingClickIndex].timestamp = latestClick.timestamp;
      existingHistory.clicks[existingClickIndex].operation = latestClick.operation;
      existingHistory.clicks[existingClickIndex].successCount = latestClick.successCount || 0;
      
      writeMCPLog(
        `[ClickHistory] Merged click at normalized (${x_normalized}, ${y_normalized}), count: ${existingHistory.clicks[existingClickIndex].count}, successCount: ${existingHistory.clicks[existingClickIndex].successCount}${incrementCount ? '' : ' (count not incremented)'}`,
        'Click History Save'
      );
    } else {
      // New coordinate, add to history
      const newStoredClick: StoredClickHistoryEntry = {
        index: latestClick.index,
        x_normalized: x_normalized,
        y_normalized: y_normalized,
        displayIndex: latestClick.displayIndex,
        displayWidth: display.width,
        displayHeight: display.height,
        timestamp: latestClick.timestamp,
        operation: latestClick.operation,
        count: latestClick.count,
        successCount: latestClick.successCount || 0, // Default to 0
      };
      
      existingHistory.clicks.push(newStoredClick);
      existingHistory.counter = latestClick.index;
      
      writeMCPLog(`[ClickHistory] Added new click #${latestClick.index}: logical (${latestClick.x}, ${latestClick.y}) → normalized (${x_normalized}, ${y_normalized}) on display ${latestClick.displayIndex}`, 'Click History Save');
    }
    
    // Update metadata
    existingHistory.lastUpdated = Date.now();
    
    // Write back to disk
    await fs.writeFile(filePath, JSON.stringify(existingHistory, null, 2), 'utf-8');
    
    writeMCPLog(`[ClickHistory] Saved latest click for app "${currentAppName}" to ${filePath}`, 'Click History Save');
  } catch (error: any) {
    writeMCPLog(`[ClickHistory] Error saving latest click: ${error.message}`, 'Click History Save Error');
  }
}

/**
 * Initialize app context for GUI operations
 * This should be called before starting GUI operations on a new app.
 *
 * This also loads an optional per-app guide file at `<appDirectory>/guide.md` (if present)
 * and returns its contents so the agent can follow app-specific instructions.
 */
async function initApp(appName: string): Promise<{
  appName: string;
  clickCount: number;
  isNew: boolean;
  appDirectory: string;
  hasGuide: boolean;
  guidePath: string;
  guide: string | null;
}> {
  // No need to save when switching apps - each click is saved individually
  
  // Check if this is a new app (no existing directory or click_history.json)
  const appDir = getAppDirectory(appName);
  const filePath = getAppClickHistoryFilePath(appName);
  let isNew = false;
  try {
    await fs.access(filePath);
  } catch {
    isNew = true;
  }
  
  // Load history for the target app
  await loadClickHistoryForApp(appName);
  await saveLastAppContext(appName);

  // Load optional per-app guide
  const guidePath = path.join(appDir, 'guide.md');
  let guide: string | null = null;
  let hasGuide = false;
  try {
    guide = await fs.readFile(guidePath, 'utf-8');
    hasGuide = true;
    writeMCPLog(`[App Init] Loaded guide.md for app "${appName}" (${guide.length} chars)`, 'App Init');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      writeMCPLog(`[App Init] Failed to read guide.md for app "${appName}": ${error.message}`, 'App Init Warning');
    }
  }
  
  writeMCPLog(`[App Init] Initialized for app "${appName}" with ${clickHistory.length} existing clicks (new: ${isNew})`, 'App Init');
  writeMCPLog(`[App Init] App directory: ${appDir}`, 'App Init');
  
  return {
    appName: appName,
    clickCount: clickHistory.length,
    isNew: isNew,
    appDirectory: appDir,
    hasGuide,
    guidePath,
    guide,
  };
}

/**
 * Add a click to history
 * If the same coordinate already exists, increment its count instead of adding a new entry
 * Automatically saves the latest click to disk
 */
async function addClickToHistory(x: number, y: number, displayIndex: number, operation: string): Promise<void> {
  // Check if this coordinate already exists in history
  const existingEntry = clickHistory.find(
    entry => entry.x === x && entry.y === y && entry.displayIndex === displayIndex
  );
  
  let latestClick: ClickHistoryEntry;
  
  if (existingEntry) {
    // Increment count for existing coordinate
    existingEntry.count++;
    existingEntry.timestamp = Date.now(); // Update timestamp
    existingEntry.operation = operation; // Update operation type
    latestClick = existingEntry;
    writeMCPLog(`[ClickHistory] Updated click at (${x}, ${y}) on display ${displayIndex}, count: ${existingEntry.count}`, 'Click History');
  } else {
    // Add new coordinate
    clickHistoryCounter++;
    latestClick = {
      index: clickHistoryCounter,
      x,
      y,
      displayIndex,
      timestamp: Date.now(),
      operation,
      count: 1,
      successCount: 0, // Initialize to 0
    };
    clickHistory.push(latestClick);
    writeMCPLog(`[ClickHistory] Added click #${clickHistoryCounter} at (${x}, ${y}) on display ${displayIndex}`, 'Click History');
  }
  
  // Track this as the most recent click for success verification
  lastClickEntry = latestClick;
  
  // Save only the latest click to disk
  await saveLatestClickToHistory(latestClick);
}

/**
 * Get click history for a specific display
 */
function getClickHistoryForDisplay(displayIndex: number): ClickHistoryEntry[] {
  return clickHistory.filter(entry => entry.displayIndex === displayIndex);
}

/**
 * Clear click history for the current app
 */
/**
 * Clear click history for the current app
 */
async function clearClickHistory(): Promise<void> {
  clickHistory.length = 0;
  clickHistoryCounter = 0;
  writeMCPLog('[ClickHistory] Cleared all click history', 'Click History');
  
  // Delete the click history file from disk
  if (currentAppName) {
    try {
      const filePath = getAppClickHistoryFilePath(currentAppName);
      await fs.unlink(filePath);
      writeMCPLog(`[ClickHistory] Deleted click history file: ${filePath}`, 'Click History');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        writeMCPLog(`[ClickHistory] Error deleting click history file: ${error.message}`, 'Click History Error');
      }
    }
  }
}

// ============================================================================
// Display Information Types
// ============================================================================

interface DisplayInfo {
  index: number;
  name: string;
  isMain: boolean;
  width: number;
  height: number;
  originX: number;  // Global coordinate origin X
  originY: number;  // Global coordinate origin Y
  scaleFactor: number;  // Retina scale factor
}

interface DisplayConfiguration {
  displays: DisplayInfo[];
  totalWidth: number;
  totalHeight: number;
  mainDisplayIndex: number;
}

// Cache for display configuration
let displayConfigCache: DisplayConfiguration | null = null;
let displayConfigCacheTime: number = 0;
const DISPLAY_CONFIG_CACHE_TTL = 5000; // 5 seconds cache

// ============================================================================
// Helper Functions
// ============================================================================

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getResourcesDirCandidates(): string[] {
  const candidates: string[] = [];

  // If Electron main process passes resourcesPath into env for spawned MCP servers
  const envResources = process.env.OPEN_COWORK_RESOURCES_PATH;
  if (envResources) candidates.push(envResources);

  // Packaged: .../Contents/Resources/mcp -> .../Contents/Resources
  candidates.push(path.resolve(__dirname, '..'));

  // Dev (running bundled JS from dist-mcp): .../dist-mcp -> .../resources
  candidates.push(path.resolve(__dirname, '..', 'resources'));

  // Dev (running TS from src/main/mcp): .../src/main/mcp -> .../resources
  candidates.push(path.resolve(__dirname, '..', '..', '..', 'resources'));

  // Dedupe
  return [...new Set(candidates)];
}

async function resolveBundledExecutable(relativeFromResources: string): Promise<string | null> {
  for (const resourcesDir of getResourcesDirCandidates()) {
    const candidate = path.join(resourcesDir, relativeFromResources);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

let cachedCliclickPath: string | null | undefined;

async function resolveCliclickPath(): Promise<string | null> {
  if (cachedCliclickPath !== undefined) return cachedCliclickPath;
  if (PLATFORM !== 'darwin') {
    cachedCliclickPath = null;
    return null;
  }

  // 1) Explicit override (useful for debugging)
  const envOverride = process.env.OPEN_COWORK_CLICLICK_PATH;
  if (envOverride && (await pathExists(envOverride))) {
    cachedCliclickPath = envOverride;
    return envOverride;
  }

  // 2) 内置随应用打包（推荐）
  // 打包布局：Resources/tools/darwin-{arch}/bin/cliclick
  // 旧版布局：Resources/tools/bin/cliclick
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const archBundled = await resolveBundledExecutable(path.join('tools', `darwin-${arch}`, 'bin', 'cliclick'));
  const legacyBundled = await resolveBundledExecutable(path.join('tools', 'bin', 'cliclick'));
  const bundled = archBundled || legacyBundled;
  if (bundled) {
    cachedCliclickPath = bundled;
    return bundled;
  }

  // 3) Common Homebrew locations (packaged apps may have limited PATH)
  const commonLocations = ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'];
  for (const p of commonLocations) {
    if (await pathExists(p)) {
      cachedCliclickPath = p;
      return p;
    }
  }

  // 4) PATH lookup
  try {
    const { stdout } = await executeCommand('/usr/bin/which cliclick', 2000);
    const whichPath = stdout.trim();
    if (whichPath) {
      cachedCliclickPath = whichPath;
      return whichPath;
    }
  } catch {
    // ignore
  }

  cachedCliclickPath = null;
  return null;
}

function normalizeModifierKeys(modifiers: string[]): string[] {
  const modifierMap: Record<string, string> = {
    'command': 'cmd',
    'cmd': 'cmd',
    'shift': 'shift',
    'option': 'alt',
    'alt': 'alt',
    'control': 'ctrl',
    'ctrl': 'ctrl',
    'control/ctrl': 'ctrl',
    'command/cmd': 'cmd',
    'option/alt': 'alt',
  };

  return modifiers
    .map(m => modifierMap[m.toLowerCase()])
    .filter((m): m is string => Boolean(m));
}

async function convertCliclickToCocoaCoordinates(
  globalX: number,
  globalY: number
): Promise<{ cocoaX: number; cocoaY: number }> {
  const config = await getDisplayConfiguration();
  const mainDisplay = config.displays.find(d => d.isMain) || config.displays[0];
  const mainHeight = mainDisplay.height;

  let targetDisplay = config.displays[0];
  for (const display of config.displays) {
    if (
      globalX >= display.originX &&
      globalX < display.originX + display.width &&
      globalY >= display.originY &&
      globalY < display.originY + display.height
    ) {
      targetDisplay = display;
      break;
    }
  }

  const localX = globalX - targetDisplay.originX;
  const localY = globalY - targetDisplay.originY;
  const originYCocoa = mainHeight - targetDisplay.height - targetDisplay.originY;
  const cocoaX = targetDisplay.originX + localX;
  const cocoaY = originYCocoa + (targetDisplay.height - localY);

  return { cocoaX, cocoaY };
}

type PythonExec = {
  python: string;
  pythonRoot: string;
  env: NodeJS.ProcessEnv;
};

let cachedPythonExec: PythonExec | null | undefined;

async function resolvePythonExec(): Promise<PythonExec | null> {
  if (cachedPythonExec !== undefined) return cachedPythonExec;

  const baseEnv: NodeJS.ProcessEnv = { ...process.env };

  // 1) Explicit override (useful for debugging)
  const envPython = process.env.OPEN_COWORK_PYTHON_PATH;
  const envPythonHome = process.env.OPEN_COWORK_PYTHON_HOME;
  if (envPython && (await pathExists(envPython))) {
    const pythonRoot = envPythonHome || path.resolve(envPython, '..', '..');
    const extraSite = path.join(pythonRoot, 'site-packages');
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      PYTHONHOME: pythonRoot,
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUTF8: '1',
    };
    if (await pathExists(extraSite)) {
      env.PYTHONPATH = [extraSite, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
    }
    cachedPythonExec = { python: envPython, pythonRoot, env };
    return cachedPythonExec;
  }

  // 2) Bundled with the app (recommended)
  // Packaged layout: Resources/python/bin/python3
  // Dev layout:      resources/python/darwin-${arch}/bin/python3
  if (PLATFORM === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const packaged = await resolveBundledExecutable(path.join('python', 'bin', 'python3'));
    const devBundled = await resolveBundledExecutable(path.join('python', `darwin-${arch}`, 'bin', 'python3'));
    const pythonPath = packaged || devBundled;
    if (pythonPath) {
      const pythonRoot = path.resolve(pythonPath, '..', '..');
      const extraSite = path.join(pythonRoot, 'site-packages');
      const env: NodeJS.ProcessEnv = {
        ...baseEnv,
        PYTHONHOME: pythonRoot,
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUTF8: '1',
      };
      if (await pathExists(extraSite)) {
        env.PYTHONPATH = [extraSite, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter);
      }

      cachedPythonExec = { python: pythonPath, pythonRoot, env };
      return cachedPythonExec;
    }

    // 3) System python (fallback)
    const systemPython = '/usr/bin/python3';
    if (await pathExists(systemPython)) {
      cachedPythonExec = {
        python: systemPython,
        pythonRoot: path.resolve(systemPython, '..', '..'),
        env: {
          ...baseEnv,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
      };
      return cachedPythonExec;
    }
  }

  // Generic fallback for other platforms: rely on PATH if available
  try {
    const { stdout } = await executeCommand(PLATFORM === 'win32' ? 'where python' : '/usr/bin/which python3', 2000);
    const p = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
    if (p) {
      cachedPythonExec = {
        python: p,
        pythonRoot: path.resolve(p, '..', '..'),
        env: {
          ...baseEnv,
          PYTHONNOUSERSITE: '1',
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
      };
      return cachedPythonExec;
    }
  } catch {
    // ignore
  }

  cachedPythonExec = null;
  return null;
}

async function executePython(
  code: string,
  timeout: number = 10000
): Promise<{ stdout: string; stderr: string }> {
  const execInfo = await resolvePythonExec();
  if (!execInfo) {
    throw new Error(
      'Python 3 runtime not found.\n' +
      '- Recommended (macOS): bundle Python into the app at Resources/python/bin/python3 with required packages (Pillow, pyobjc-framework-Quartz)\n' +
      '- Or install python3 + dependencies on this machine.\n'
    );
  }

  const { python, env } = execInfo;

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(python, ['-c', code], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('Python execution timed out'));
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Python spawn failed: ${err.message}`));
    });

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const msg = (stderr || stdout).trim();
        reject(new Error(msg || `Python exited with code ${code}`));
      }
    });
  });
}

async function performMacMouseMoveViaQuartz(
  globalX: number,
  globalY: number,
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (${cocoaX}, ${cocoaY}), Quartz.kCGMouseButtonLeft)
if flags:
  Quartz.CGEventSetFlags(event, flags)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
  `.trim();
  await executePython(script, 5000);
}

async function performMacClickViaQuartz(
  globalX: number,
  globalY: number,
  clickType: 'single' | 'double' | 'right' | 'triple',
  modifiers: string[]
): Promise<void> {
  const { cocoaX, cocoaY } = await convertCliclickToCocoaCoordinates(globalX, globalY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const clickCount = clickType === 'double' ? 2 : clickType === 'triple' ? 3 : 1;
  const isRight = clickType === 'right';
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
button = Quartz.kCGMouseButtonRight if ${isRight ? 'True' : 'False'} else Quartz.kCGMouseButtonLeft
down_event = Quartz.kCGEventRightMouseDown if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseDown
up_event = Quartz.kCGEventRightMouseUp if ${isRight ? 'True' : 'False'} else Quartz.kCGEventLeftMouseUp
def post(evt_type, click_state):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (${cocoaX}, ${cocoaY}), button)
  Quartz.CGEventSetIntegerValueField(ev, Quartz.kCGMouseEventClickState, click_state)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
for i in range(${clickCount}):
  state = i + 1 if ${clickCount} > 1 else 1
  post(down_event, state)
  post(up_event, state)
  if ${clickCount} > 1:
    time.sleep(0.05)
  `.trim();
  await executePython(script, 8000);
}

async function performMacDragViaQuartz(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  modifiers: string[]
): Promise<void> {
  const from = await convertCliclickToCocoaCoordinates(fromX, fromY);
  const to = await convertCliclickToCocoaCoordinates(toX, toY);
  const modsJson = JSON.stringify(normalizeModifierKeys(modifiers));
  const script = `
import Quartz, json, time
mods = json.loads(${JSON.stringify(modsJson)})
flag_map = {
  "cmd": Quartz.kCGEventFlagMaskCommand,
  "ctrl": Quartz.kCGEventFlagMaskControl,
  "shift": Quartz.kCGEventFlagMaskShift,
  "alt": Quartz.kCGEventFlagMaskAlternate,
}
flags = 0
for m in mods:
  flags |= flag_map.get(m, 0)
def post(evt_type, x, y):
  ev = Quartz.CGEventCreateMouseEvent(None, evt_type, (x, y), Quartz.kCGMouseButtonLeft)
  if flags:
    Quartz.CGEventSetFlags(ev, flags)
  Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
post(Quartz.kCGEventLeftMouseDown, ${from.cocoaX}, ${from.cocoaY})
post(Quartz.kCGEventLeftMouseDragged, ${to.cocoaX}, ${to.cocoaY})
post(Quartz.kCGEventLeftMouseUp, ${to.cocoaX}, ${to.cocoaY})
  `.trim();
  await executePython(script, 8000);
}

async function macReadClipboardBytes(timeoutMs: number = 2000): Promise<Buffer | null> {
  if (PLATFORM !== 'darwin') return null;

  const pbpastePath = '/usr/bin/pbpaste';
  return await new Promise<Buffer | null>((resolve) => {
    const child = spawn(pbpastePath, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve(null);
    }, timeoutMs);

    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    child.stdout.on('data', (d) => {
      stdoutChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks));
      } else {
        resolve(null);
      }
    });
  });
}

async function macWriteClipboardBytes(bytes: Buffer, timeoutMs: number = 5000): Promise<void> {
  if (PLATFORM !== 'darwin') {
    throw new Error('pbcopy is only available on macOS.');
  }

  const pbcopyPath = '/usr/bin/pbcopy';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pbcopyPath, [], { stdio: ['pipe', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error('pbcopy timed out'));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stderr.on('data', (d) => {
      stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
    });

    child.stdin.on('error', () => {
      // Ignore stdin errors here; we'll rely on exit code/stderr.
    });

    child.stdin.end(bytes);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(stderr || `pbcopy exited with code ${code}`));
      }
    });
  });
}

/**
 * Execute a shell command with timeout
 */
async function executeCommand(
  command: string,
  timeout: number = 10000
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execAsync(command, { timeout });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error: any) {
    throw new Error(`Command execution failed: ${error.message}`);
  }
}

async function getFrontmostMacApplicationName(): Promise<string | null> {
  if (PLATFORM !== 'darwin') return null;

  try {
    const { stdout } = await executeCommand(
      `/usr/bin/osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      5000
    );
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}

async function getMacDockItemsViaAccessibility(): Promise<DockItemInfo[]> {
  if (PLATFORM !== 'darwin') return [];

  const jxaScript = [
    'const se = Application("System Events");',
    'const dock = se.processes.byName("Dock");',
    'const items = dock.lists[0].uiElements();',
    'const out = [];',
    'for (let i = 0; i < items.length; i++) {',
    '  try {',
    '    const n = String(items[i].name());',
    '    const p = items[i].position();',
    '    const s = items[i].size();',
    '    if (!n || n === "missing value" || n === "null") continue;',
    '    out.push({name:n, x:Number(p[0]), y:Number(p[1]), width:Number(s[0]), height:Number(s[1])});',
    '  } catch (e) {}',
    '}',
    'JSON.stringify(out);',
  ].join(' ');

  const command = `/usr/bin/osascript -l JavaScript -e '${jxaScript.replace(/'/g, "'\"'\"'")}'`;
  const { stdout } = await executeCommand(command, 10000);

  const parsed = JSON.parse(stdout.trim()) as DockItemInfo[];
  return parsed.filter(item =>
    item
    && typeof item.name === 'string'
    && typeof item.x === 'number'
    && typeof item.y === 'number'
    && typeof item.width === 'number'
    && typeof item.height === 'number'
    && item.width > 0
    && item.height > 0
  );
}

async function tryLocateElementInDockByAccessibility(
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
} | null> {
  if (!isDescriptionDockRelated(elementDescription)) {
    return null;
  }

  const dockItems = await getMacDockItemsViaAccessibility();
  if (dockItems.length === 0) {
    return null;
  }

  let bestItem: DockItemInfo | null = null;
  let bestScore = 0;

  for (const item of dockItems) {
    const score = scoreDockItemAgainstDescription(item.name, elementDescription);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  if (!bestItem || bestScore < 120) {
    writeMCPLog(
      `[dock-accessibility] No reliable Dock match for "${elementDescription}". Best score: ${bestScore}`,
      'Dock Locate'
    );
    return null;
  }

  const centerGlobalX = Math.round(bestItem.x + bestItem.width / 2);
  const centerGlobalY = Math.round(bestItem.y + bestItem.height / 2);
  const config = await getDisplayConfiguration();

  let targetDisplay = config.displays.find(d =>
    centerGlobalX >= d.originX
    && centerGlobalX <= (d.originX + d.width)
    && centerGlobalY >= d.originY
    && centerGlobalY <= (d.originY + d.height)
  );

  if (!targetDisplay) {
    targetDisplay = displayIndex !== undefined
      ? config.displays.find(d => d.index === displayIndex)
      : config.displays.find(d => d.isMain);
  }

  if (!targetDisplay) {
    return null;
  }

  const localX = Math.round(centerGlobalX - targetDisplay.originX);
  const localY = Math.round(centerGlobalY - targetDisplay.originY);

  writeMCPLog(
    `[dock-accessibility] Matched "${bestItem.name}" for "${elementDescription}" at global (${centerGlobalX}, ${centerGlobalY}), local (${localX}, ${localY}), display ${targetDisplay.index}, score=${bestScore}`,
    'Dock Locate'
  );

  return {
    x: localX,
    y: localY,
    confidence: Math.min(99, bestScore),
    displayIndex: targetDisplay.index,
    reasoning: `Matched Dock item "${bestItem.name}" via macOS Accessibility.`,
  };
}

/**
 * Execute cliclick command with error handling (macOS only)
 */
async function executeCliclick(command: string): Promise<{ stdout: string; stderr: string }> {
  if (PLATFORM !== 'darwin') {
    throw new Error('cliclick is only available on macOS. Use Windows-specific functions instead.');
  }

  const cliclickPath = await resolveCliclickPath();
  if (!cliclickPath) {
    throw new Error(
      'cliclick is required for GUI automation on macOS but was not found.\n' +
      `- Recommended: bundle it inside the app at Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick\n` +
      '- Or legacy path: Resources/tools/bin/cliclick\n' +
      '- Or install it on this machine: brew install cliclick\n' +
      `Searched: bundled Resources/tools/darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}/bin/cliclick, ` +
      'Resources/tools/bin/cliclick, /opt/homebrew/bin/cliclick, /usr/local/bin/cliclick, and PATH.'
    );
  }

  const quotedCliclick = `"${cliclickPath.replace(/"/g, '\\"')}"`;
  const fullCommand = `${quotedCliclick} ${command}`;
  writeMCPLog(`[executeCliclick] Executing command: ${fullCommand}`, 'Cliclick Command');

  try {
  const result = await executeCommand(fullCommand);
  writeMCPLog(`[executeCliclick] Command completed. stdout: ${result.stdout}, stderr: ${result.stderr}`, 'Cliclick Result');

  // cliclick may exit 0 while warning that Accessibility permission is missing.
  // Treat this as a hard failure to avoid reporting false-positive click success.
  if (/Accessibility privileges not enabled/i.test(result.stderr || '')) {
    const hint =
      '\n\nmacOS 权限提示 / Permissions:\n' +
      '- System Settings → Privacy & Security → Accessibility：允许 Open Cowork\n' +
      '- 如果是终端运行：允许 Terminal/iTerm\n' +
      '- 授权后请重启 Open Cowork 再重试\n';
    throw new Error(`cliclick cannot control UI because Accessibility permission is not enabled.${hint}`);
  }

  return result;
  } catch (error: any) {
    const baseMessage = error?.message || String(error);
    const hint =
      '\n\nmacOS 权限提示 / Permissions:\n' +
      '- System Settings → Privacy & Security → Accessibility：允许 Open Cowork\n' +
      '- System Settings → Privacy & Security → Automation：允许 Open Cowork 控制 “System Events”\n';
    throw new Error(`${baseMessage}${hint}`);
  }
}

// ============================================================================
// Windows-specific Helper Functions
// ============================================================================

/**
 * Execute PowerShell command (Windows only)
 * Uses -WindowStyle Hidden to prevent focus theft from target windows
 */
async function executePowerShell(script: string, timeout: number = 30000): Promise<{ stdout: string; stderr: string }> {
  if (PLATFORM !== 'win32') {
    throw new Error('PowerShell is only available on Windows.');
  }
  
  // Escape the script for PowerShell command line
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  // Use -WindowStyle Hidden to prevent PowerShell window from stealing focus
  const command = `powershell -WindowStyle Hidden -NonInteractive -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`;
  
  writeMCPLog(`[executePowerShell] Executing script (length: ${script.length})`, 'PowerShell Command');
  
  const result = await executeCommand(command, timeout);
  
  writeMCPLog(`[executePowerShell] Command completed. stdout length: ${result.stdout.length}`, 'PowerShell Result');
  
  return result;
}

/**
 * Windows: Take screenshot using .NET with DPI awareness
 */
async function windowsTakeScreenshot(
  outputPath: string,
  displayIndex?: number,
  region?: { x: number; y: number; width: number; height: number }
): Promise<void> {
  let script: string;
  
  // Common DPI-aware setup code
  const dpiAwareSetup = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Enable DPI awareness to get actual physical screen dimensions
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiHelper {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
    
    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
}
"@

# Make process DPI-aware
[DpiHelper]::SetProcessDPIAware() | Out-Null

# Get actual screen dimensions using GetSystemMetrics
# SM_CXSCREEN = 0, SM_CYSCREEN = 1 (primary screen)
# SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79 (virtual screen)
`;
  
  if (region) {
    // Capture specific region
    script = `${dpiAwareSetup}

$x = ${region.x}
$y = ${region.y}
$width = ${region.width}
$height = ${region.height}

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($x, $y, 0, 0, [System.Drawing.Size]::new($width, $height))
$bitmap.Save("${outputPath.replace(/\\/g, '\\\\')}")
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "SUCCESS"
`;
  } else if (displayIndex !== undefined) {
    // Capture specific display with DPI awareness
    script = `${dpiAwareSetup}

$targetIndex = ${displayIndex}

# Get physical screen dimensions
if ($targetIndex -eq 0) {
    # Primary screen - use GetSystemMetrics for accurate physical dimensions
    $physWidth = [DpiHelper]::GetSystemMetrics(0)   # SM_CXSCREEN
    $physHeight = [DpiHelper]::GetSystemMetrics(1)  # SM_CYSCREEN
    $physX = 0
    $physY = 0
} else {
    # For non-primary displays, use virtual screen metrics
    # This is a simplified approach - may need refinement for multi-monitor setups
    $screens = [System.Windows.Forms.Screen]::AllScreens
    if ($targetIndex -ge $screens.Length) {
        Write-Error "Display index $targetIndex not found. Available: 0-$($screens.Length - 1)"
        exit 1
    }
    $screen = $screens[$targetIndex]
    
    # Get DPI scaling factor
    $hdc = [DpiHelper]::GetDC([IntPtr]::Zero)
    $dpiX = [DpiHelper]::GetDeviceCaps($hdc, 88)  # LOGPIXELSX
    [DpiHelper]::ReleaseDC([IntPtr]::Zero, $hdc) | Out-Null
    $scaleFactor = $dpiX / 96.0
    
    # Scale the bounds to physical pixels
    $physX = [int]($screen.Bounds.X * $scaleFactor)
    $physY = [int]($screen.Bounds.Y * $scaleFactor)
    $physWidth = [int]($screen.Bounds.Width * $scaleFactor)
    $physHeight = [int]($screen.Bounds.Height * $scaleFactor)
}

$bitmap = New-Object System.Drawing.Bitmap($physWidth, $physHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($physX, $physY, 0, 0, [System.Drawing.Size]::new($physWidth, $physHeight))
$bitmap.Save("${outputPath.replace(/\\/g, '\\\\')}")
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "SUCCESS"
`;
  } else {
    // Capture primary screen when no displayIndex specified (NOT virtual screen)
    // This ensures coordinate system consistency
    script = `${dpiAwareSetup}

# Get primary screen dimensions using GetSystemMetrics
$physWidth = [DpiHelper]::GetSystemMetrics(0)   # SM_CXSCREEN
$physHeight = [DpiHelper]::GetSystemMetrics(1)  # SM_CYSCREEN
$physX = 0
$physY = 0

$bitmap = New-Object System.Drawing.Bitmap($physWidth, $physHeight)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($physX, $physY, 0, 0, [System.Drawing.Size]::new($physWidth, $physHeight))
$bitmap.Save("${outputPath.replace(/\\/g, '\\\\')}")
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "SUCCESS"
`;
  }
  
  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Screenshot failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Get display configuration with DPI awareness
 */
async function windowsGetDisplayConfiguration(): Promise<DisplayConfiguration> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms

# Get DPI scaling factor
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiInfo {
    [DllImport("gdi32.dll")]
    public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetDC(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int nIndex);
}
"@

# Make process DPI-aware
[DpiInfo]::SetProcessDPIAware() | Out-Null

# Get DPI scaling factor (default DPI is 96)
$hdc = [DpiInfo]::GetDC([IntPtr]::Zero)
$dpiX = [DpiInfo]::GetDeviceCaps($hdc, 88)  # LOGPIXELSX
[DpiInfo]::ReleaseDC([IntPtr]::Zero, $hdc) | Out-Null
$scaleFactor = $dpiX / 96.0

$screens = [System.Windows.Forms.Screen]::AllScreens
$result = @()
$index = 0

foreach ($screen in $screens) {
    # For primary monitor, get physical dimensions
    if ($screen.Primary) {
        $physWidth = [DpiInfo]::GetSystemMetrics(0)   # SM_CXSCREEN
        $physHeight = [DpiInfo]::GetSystemMetrics(1)  # SM_CYSCREEN
    } else {
        # Scale logical dimensions to physical for non-primary
        $physWidth = [int]($screen.Bounds.Width * $scaleFactor)
        $physHeight = [int]($screen.Bounds.Height * $scaleFactor)
    }
    
    $info = @{
        index = $index
        name = $screen.DeviceName
        isMain = $screen.Primary
        width = $physWidth
        height = $physHeight
        originX = [int]($screen.Bounds.X * $scaleFactor)
        originY = [int]($screen.Bounds.Y * $scaleFactor)
        scaleFactor = $scaleFactor
    }
    $result += $info
    $index++
}

# Force output as array even if single element (wrap in @())
ConvertTo-Json -InputObject @($result) -Compress
`;

  const result = await executePowerShell(script);
  let displays: DisplayInfo[] = JSON.parse(result.stdout.trim());
  
  // Ensure displays is an array (PowerShell may return single object instead of array)
  if (!Array.isArray(displays)) {
    displays = [displays];
  }
  
  // Sort by index
  displays.sort((a, b) => a.index - b.index);
  
  // Find main display
  const mainDisplay = displays.find(d => d.isMain) || displays[0];
  const mainDisplayIndex = mainDisplay?.index || 0;
  
  // Calculate total dimensions
  let totalWidth = 0;
  let totalHeight = 0;
  
  for (const display of displays) {
    const right = display.originX + display.width;
    const bottom = display.originY + display.height;
    if (right > totalWidth) totalWidth = right;
    if (bottom > totalHeight) totalHeight = bottom;
  }
  
  return {
    displays,
    totalWidth,
    totalHeight,
    mainDisplayIndex,
  };
}

/**
 * Windows: Perform mouse click using SendInput API
 */
async function windowsPerformClick(
  globalX: number,
  globalY: number,
  clickType: 'single' | 'double' | 'right' | 'triple' = 'single',
  modifiers: string[] = []
): Promise<void> {
  // Build modifier key press/release scripts
  let modifierDown = '';
  let modifierUp = '';
  
  for (const mod of modifiers) {
    const modLower = mod.toLowerCase();
    // Virtual key codes: Ctrl=0x11, Shift=0x10, Alt=0x12
    if (modLower === 'ctrl' || modLower === 'control') {
      modifierDown += '[Win32Functions.mouse_event]::keybd_event(0x11, 0, 0, 0)\n';
      modifierUp += '[Win32Functions.mouse_event]::keybd_event(0x11, 0, 2, 0)\n';
    } else if (modLower === 'shift') {
      modifierDown += '[Win32Functions.mouse_event]::keybd_event(0x10, 0, 0, 0)\n';
      modifierUp += '[Win32Functions.mouse_event]::keybd_event(0x10, 0, 2, 0)\n';
    } else if (modLower === 'alt' || modLower === 'option') {
      modifierDown += '[Win32Functions.mouse_event]::keybd_event(0x12, 0, 0, 0)\n';
      modifierUp += '[Win32Functions.mouse_event]::keybd_event(0x12, 0, 2, 0)\n';
    } else if (modLower === 'cmd' || modLower === 'command') {
      // Map Cmd to Ctrl on Windows
      modifierDown += '[Win32Functions.mouse_event]::keybd_event(0x11, 0, 0, 0)\n';
      modifierUp += '[Win32Functions.mouse_event]::keybd_event(0x11, 0, 2, 0)\n';
    }
  }
  
  let clickScript = '';
  
  switch (clickType) {
    case 'double':
      clickScript = `
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
Start-Sleep -Milliseconds 50
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
`;
      break;
    case 'right':
      clickScript = `
[Win32Functions.mouse_event]::mouse_event(0x0008, 0, 0, 0, 0)  # Right down
[Win32Functions.mouse_event]::mouse_event(0x0010, 0, 0, 0, 0)  # Right up
`;
      break;
    case 'triple':
      clickScript = `
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
Start-Sleep -Milliseconds 50
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
Start-Sleep -Milliseconds 50
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
`;
      break;
    case 'single':
    default:
      clickScript = `
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)  # Left down
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)  # Left up
`;
      break;
  }
  
  const script = `
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
[DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
"@

Add-Type -MemberDefinition $signature -Name mouse_event -Namespace Win32Functions

# Set DPI awareness for accurate cursor positioning
[Win32Functions.mouse_event]::SetProcessDPIAware() | Out-Null

# Set cursor position
[Win32Functions.mouse_event]::SetCursorPos(${globalX}, ${globalY})
Start-Sleep -Milliseconds 50

# Press modifier keys
${modifierDown}

# Perform click
${clickScript}

# Release modifier keys
${modifierUp}

Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Click failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Perform keyboard input using clipboard paste
 * Simplified version that just sends Ctrl+V to the currently focused control
 * The click operation should have already focused the target control
 */
async function windowsPerformType(
  text: string,
  pressEnter: boolean = false
): Promise<void> {
  // Escape text for PowerShell
  const escapedText = text.replace(/"/g, '`"').replace(/\$/g, '`$').replace(/`/g, '``');
  
  const script = `
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
"@

Add-Type -MemberDefinition $signature -Name Win32 -Namespace User32

# Save original clipboard content
$originalClip = $null
try {
    $originalClip = [System.Windows.Forms.Clipboard]::GetText()
} catch {}

# Set the text to clipboard
[System.Windows.Forms.Clipboard]::SetText("${escapedText}")

# Small delay to ensure clipboard is set
Start-Sleep -Milliseconds 50

# Send Ctrl+V to paste to whatever control is currently focused
# VK_CONTROL = 0x11, VK_V = 0x56
# KEYEVENTF_KEYDOWN = 0, KEYEVENTF_KEYUP = 2
[User32.Win32]::keybd_event(0x11, 0, 0, 0)  # Ctrl down
Start-Sleep -Milliseconds 30
[User32.Win32]::keybd_event(0x56, 0, 0, 0)  # V down
Start-Sleep -Milliseconds 30
[User32.Win32]::keybd_event(0x56, 0, 2, 0)  # V up
Start-Sleep -Milliseconds 30
[User32.Win32]::keybd_event(0x11, 0, 2, 0)  # Ctrl up

Start-Sleep -Milliseconds 50

${pressEnter ? `
# Send Enter key
# VK_RETURN = 0x0D
Start-Sleep -Milliseconds 50
[User32.Win32]::keybd_event(0x0D, 0, 0, 0)  # Enter down
Start-Sleep -Milliseconds 30
[User32.Win32]::keybd_event(0x0D, 0, 2, 0)  # Enter up
` : ''}

# Restore original clipboard if possible
if ($originalClip) {
    Start-Sleep -Milliseconds 100
    try {
        [System.Windows.Forms.Clipboard]::SetText($originalClip)
    } catch {}
}

Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Type failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Press a key or key combination using keybd_event (more reliable)
 */
async function windowsPerformKeyPress(
  key: string,
  modifiers: string[] = []
): Promise<void> {
  // Map key names to virtual key codes
  const vkMap: Record<string, number> = {
    'enter': 0x0D, 'return': 0x0D,
    'tab': 0x09,
    'escape': 0x1B, 'esc': 0x1B,
    'space': 0x20,
    'delete': 0x2E, 'del': 0x2E,
    'backspace': 0x08,
    'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
    'home': 0x24, 'end': 0x23,
    'pageup': 0x21, 'pgup': 0x21,
    'pagedown': 0x22, 'pgdn': 0x22,
    'insert': 0x2D,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
    'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
    'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    // Letters
    'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45,
    'f': 0x46, 'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A,
    'k': 0x4B, 'l': 0x4C, 'm': 0x4D, 'n': 0x4E, 'o': 0x4F,
    'p': 0x50, 'q': 0x51, 'r': 0x52, 's': 0x53, 't': 0x54,
    'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58, 'y': 0x59, 'z': 0x5A,
    // Numbers
    '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
    '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  };
  
  const keyLower = key.toLowerCase();
  const vkCode = vkMap[keyLower];
  
  if (vkCode === undefined) {
    throw new Error(`Unknown key: ${key}`);
  }
  
  // Map modifier names to virtual key codes
  const modifierCodes: number[] = [];
  for (const mod of modifiers) {
    const modLower = mod.toLowerCase();
    if (modLower === 'ctrl' || modLower === 'control') {
      modifierCodes.push(0x11); // VK_CONTROL
    } else if (modLower === 'shift') {
      modifierCodes.push(0x10); // VK_SHIFT
    } else if (modLower === 'alt' || modLower === 'option') {
      modifierCodes.push(0x12); // VK_MENU (Alt)
    } else if (modLower === 'cmd' || modLower === 'command') {
      modifierCodes.push(0x11); // Map Cmd to Ctrl on Windows
    }
  }
  
  // Build PowerShell script
  const modDownScript = modifierCodes.map(code => 
    `[User32.Win32]::keybd_event(${code}, 0, 0, 0)`
  ).join('\n');
  
  const modUpScript = modifierCodes.slice().reverse().map(code => 
    `[User32.Win32]::keybd_event(${code}, 0, 2, 0)`
  ).join('\n');
  
  const script = `
$signature = @"
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
"@

Add-Type -MemberDefinition $signature -Name Win32 -Namespace User32

# Press modifier keys
${modDownScript}

# Press and release the main key
[User32.Win32]::keybd_event(${vkCode}, 0, 0, 0)
Start-Sleep -Milliseconds 50
[User32.Win32]::keybd_event(${vkCode}, 0, 2, 0)

# Release modifier keys
${modUpScript}

Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Key press failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Perform scroll operation
 */
async function windowsPerformScroll(
  globalX: number,
  globalY: number,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 3
): Promise<void> {
  // WHEEL_DELTA is 120, amount is number of notches
  const wheelDelta = direction === 'up' ? (120 * amount) : 
                     direction === 'down' ? (-120 * amount) : 0;
  const hWheelDelta = direction === 'left' ? (-120 * amount) :
                      direction === 'right' ? (120 * amount) : 0;
  
  const script = `
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
[DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
"@

Add-Type -MemberDefinition $signature -Name mouse_event -Namespace Win32Functions

# Set DPI awareness
[Win32Functions.mouse_event]::SetProcessDPIAware() | Out-Null

# Set cursor position
[Win32Functions.mouse_event]::SetCursorPos(${globalX}, ${globalY})
Start-Sleep -Milliseconds 50

# Perform scroll (0x0800 = MOUSEEVENTF_WHEEL, 0x01000 = MOUSEEVENTF_HWHEEL)
${wheelDelta !== 0 ? `[Win32Functions.mouse_event]::mouse_event(0x0800, 0, 0, ${wheelDelta}, 0)` : ''}
${hWheelDelta !== 0 ? `[Win32Functions.mouse_event]::mouse_event(0x01000, 0, 0, ${hWheelDelta}, 0)` : ''}

Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Scroll failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Get mouse position
 */
async function windowsGetMousePosition(): Promise<{ globalX: number; globalY: number }> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$pos = [System.Windows.Forms.Cursor]::Position
Write-Output "$($pos.X),$($pos.Y)"
`;

  const result = await executePowerShell(script);
  const match = result.stdout.trim().match(/(\d+),(\d+)/);
  
  if (!match) {
    throw new Error(`Failed to parse mouse position: ${result.stdout}`);
  }
  
  return {
    globalX: parseInt(match[1]),
    globalY: parseInt(match[2]),
  };
}

/**
 * Windows: Move mouse to position
 */
async function windowsMoveMouse(globalX: number, globalY: number): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
[DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
"@

Add-Type -MemberDefinition $signature -Name SetCursorPos -Namespace Win32Functions

# Set DPI awareness
[Win32Functions.SetCursorPos]::SetProcessDPIAware() | Out-Null

[Win32Functions.SetCursorPos]::SetCursorPos(${globalX}, ${globalY})
Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Move mouse failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Windows: Perform drag operation
 */
async function windowsPerformDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms

$signature = @"
[DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")]
public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
"@

Add-Type -MemberDefinition $signature -Name mouse_event -Namespace Win32Functions

# Set DPI awareness
[Win32Functions.mouse_event]::SetProcessDPIAware() | Out-Null

# Move to start position
[Win32Functions.mouse_event]::SetCursorPos(${fromX}, ${fromY})
Start-Sleep -Milliseconds 50

# Press left button
[Win32Functions.mouse_event]::mouse_event(0x0002, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50

# Move to end position
[Win32Functions.mouse_event]::SetCursorPos(${toX}, ${toY})
Start-Sleep -Milliseconds 50

# Release left button
[Win32Functions.mouse_event]::mouse_event(0x0004, 0, 0, 0, 0)

Write-Output "SUCCESS"
`;

  const result = await executePowerShell(script);
  
  if (!result.stdout.includes('SUCCESS')) {
    throw new Error(`Drag failed: ${result.stderr || result.stdout}`);
  }
}

// ============================================================================
// Display Information Functions
// ============================================================================

/**
 * Get display configuration using platform-specific methods
 * - macOS: AppleScript/system_profiler
 * - Windows: PowerShell with System.Windows.Forms
 * Returns information about all connected displays
 */
async function getDisplayConfiguration(): Promise<DisplayConfiguration> {
  // Check cache
  const now = Date.now();
  if (displayConfigCache && (now - displayConfigCacheTime) < DISPLAY_CONFIG_CACHE_TTL) {
    return displayConfigCache;
  }
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    try {
      const config = await windowsGetDisplayConfiguration();
      displayConfigCache = config;
      displayConfigCacheTime = now;
      return config;
    } catch (error: any) {
      throw new Error(`Failed to get display information on Windows: ${error.message}`);
    }
  }
  
  // macOS implementation follows
  if (PLATFORM !== 'darwin') {
    throw new Error(`Display detection is not supported on platform: ${PLATFORM}`);
  }
  
  try {
    // Use AppleScript to get accurate display information
    // This provides the actual coordinate system used by the OS
    const appleScript = `
      use framework "AppKit"
      use scripting additions
      
      set displayList to ""
      set screenCount to (current application's NSScreen's screens()'s |count|())
      
      repeat with i from 1 to screenCount
        set theScreen to (current application's NSScreen's screens()'s objectAtIndex:(i - 1))
        set theFrame to theScreen's frame()
        set theVisibleFrame to theScreen's visibleFrame()
        
        -- Get display name (if available)
        set displayName to "Display " & i
        
        -- Check if this is the main display
        set isMain to (theScreen's isEqual:(current application's NSScreen's mainScreen())) as boolean
        
        -- Get coordinates
        set originX to (current application's NSMinX(theFrame)) as integer
        set originY to (current application's NSMinY(theFrame)) as integer
        set screenWidth to (current application's NSWidth(theFrame)) as integer
        set screenHeight to (current application's NSHeight(theFrame)) as integer
        
        -- Get scale factor (for Retina displays)
        set scaleFactor to (theScreen's backingScaleFactor()) as real
        
        set displayInfo to "index:" & (i - 1) & ",name:" & displayName & ",isMain:" & isMain & ",width:" & screenWidth & ",height:" & screenHeight & ",originX:" & originX & ",originY:" & originY & ",scaleFactor:" & scaleFactor
        
        if displayList is "" then
          set displayList to displayInfo
        else
          set displayList to displayList & "|" & displayInfo
        end if
      end repeat
      
      return displayList
    `;
    
    const result = await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
    const output = result.stdout.trim();
    
    if (!output) {
      throw new Error('No display information returned from AppleScript');
    }
    
    // Parse the display information
    const displays: DisplayInfo[] = [];
    const displayStrings = output.split('|');
    
    for (const displayStr of displayStrings) {
      const props: Record<string, string> = {};
      for (const prop of displayStr.split(',')) {
        const [key, value] = prop.split(':');
        if (key && value !== undefined) {
          props[key] = value;
        }
      }
      
      displays.push({
        index: parseInt(props['index'] || '0'),
        name: props['name'] || 'Unknown Display',
        isMain: props['isMain'] === 'true',
        width: parseInt(props['width'] || '1920'),
        height: parseInt(props['height'] || '1080'),
        originX: parseInt(props['originX'] || '0'),
        originY: parseInt(props['originY'] || '0'),
        scaleFactor: parseFloat(props['scaleFactor'] || '1.0'),
      });
    }
    
    // Sort displays by index
    displays.sort((a, b) => a.index - b.index);
    
    // Find main display for coordinate conversion
    const mainDisplay = displays.find(d => d.isMain) || displays[0];
    const mainDisplayIndex = mainDisplay.index;
    const mainDisplayHeight = mainDisplay.height;
    
    // Convert Cocoa coordinates (bottom-left origin) to cliclick coordinates (top-left origin)
    // In Cocoa coordinate system:
    // - Main display: origin = (0, 0) at bottom-left, Y increases upward
    // - originY is the Y coordinate of the BOTTOM edge of the display
    // - Main display's bottom edge is at Y=0
    // - Secondary display above main: originY > 0 (bottom edge above main's bottom)
    // - Secondary display below main: originY < 0 (bottom edge below main's bottom)
    // - Secondary display at same level: originY = 0
    //
    // In cliclick coordinate system:
    // - Main display: origin = (0, 0) at top-left, Y increases downward
    // - originY is the Y coordinate of the TOP edge of the display
    // - Main display's top edge is at Y=0
    //
    // Conversion formula:
    // - Top edge of display in Cocoa = originY + height
    // - Top edge of display in cliclick = mainHeight - (originY + height)
    // - But if originY is negative and we want to align tops, we need different logic
    
    const convertedDisplays: DisplayInfo[] = displays.map(display => {
      let cliclickOriginY: number;
      
      if (display.isMain) {
        // Main display: originY in Cocoa is 0 (bottom), in cliclick should be 0 (top)
        cliclickOriginY = 0;
        writeMCPLog(`[Display Config] Display ${display.index} (Main): Cocoa originY=${display.originY}, cliclick originY=${cliclickOriginY}`, 'Coordinate Conversion');
      } else {
        // For secondary displays, convert from Cocoa (bottom-left) to cliclick (top-left)
        // Cocoa: originY is the Y coordinate of the bottom edge
        // Cocoa: top edge Y = originY + height
        // cliclick: top edge Y = mainHeight - (cocoa_top_edge_Y)
        // cliclick: top edge Y = mainHeight - (originY + height)
        
        const cocoaTopEdge = display.originY + display.height;
        cliclickOriginY = mainDisplayHeight - cocoaTopEdge;
        
        writeMCPLog(`[Display Config] Display ${display.index}: Cocoa originY=${display.originY}, height=${display.height}, cocoaTopEdge=${cocoaTopEdge}, mainHeight=${mainDisplayHeight}, cliclick originY=${cliclickOriginY}`, 'Coordinate Conversion');
      }
      
      return {
        ...display,
        originY: cliclickOriginY,
      };
    });
    
    // Calculate total dimensions in cliclick coordinate system
    let totalWidth = 0;
    let maxHeight = 0;
    let maxDisplayHeight = 0;
    
    for (const display of convertedDisplays) {
      const right = display.originX + display.width;
      const bottom = display.originY + display.height;
      
      if (right > totalWidth) {
        totalWidth = right;
      }
      if (bottom > maxHeight) {
        maxHeight = bottom;
      }
      // Track the tallest individual display
      if (display.height > maxDisplayHeight) {
        maxDisplayHeight = display.height;
      }
      
      writeMCPLog(`[Display Config] Display ${display.index}: originX=${display.originX}, originY=${display.originY}, width=${display.width}, height=${display.height}, right=${right}, bottom=${bottom}`, 'Dimension Calculation');
    }
    
    // totalHeight should be the maximum height among all displays
    // This is the tallest display's height, not the sum of all heights
    const totalHeight = maxDisplayHeight;
    
    writeMCPLog(`[Display Config] Total dimensions: width=${totalWidth}, height=${totalHeight}, maxBottom=${maxHeight}`, 'Dimension Calculation');
    
    const config: DisplayConfiguration = {
      displays: convertedDisplays,
      totalWidth,
      totalHeight,
      mainDisplayIndex,
    };
    
    // Update cache
    displayConfigCache = config;
    displayConfigCacheTime = now;
    
    return config;
  } catch (error: any) {
    // Fallback: Use system_profiler for basic info
    writeMCPLog(`AppleScript display detection failed, using fallback: ${error.message}`, 'Display Detection');
    
    try {
      const result = await executeCommand('system_profiler SPDisplaysDataType -json');
      const data = JSON.parse(result.stdout);
      const displays: DisplayInfo[] = [];
      
      let index = 0;
      for (const gpu of data.SPDisplaysDataType || []) {
        for (const display of gpu.spdisplays_ndrvs || []) {
          const resolution = display._spdisplays_resolution || '';
          const match = resolution.match(/(\d+)\s*x\s*(\d+)/);
          
          displays.push({
            index,
            name: display._name || `Display ${index + 1}`,
            isMain: display.spdisplays_main === 'spdisplays_yes',
            width: match ? parseInt(match[1]) : 1920,
            height: match ? parseInt(match[2]) : 1080,
            originX: 0,  // system_profiler doesn't provide origin
            originY: 0,
            scaleFactor: resolution.includes('Retina') ? 2.0 : 1.0,
          });
          index++;
        }
      }
      
      // If no displays found, return default
      if (displays.length === 0) {
        displays.push({
          index: 0,
          name: 'Main Display',
          isMain: true,
          width: 1920,
          height: 1080,
          originX: 0,
          originY: 0,
          scaleFactor: 1.0,
        });
      }
      
      const config: DisplayConfiguration = {
        displays,
        totalWidth: displays.reduce((max, d) => Math.max(max, d.originX + d.width), 0),
        totalHeight: displays.reduce((max, d) => Math.max(max, Math.abs(d.originY) + d.height), 0),
        mainDisplayIndex: displays.findIndex(d => d.isMain) || 0,
      };
      
      displayConfigCache = config;
      displayConfigCacheTime = now;
      
      return config;
    } catch (fallbackError: any) {
      throw new Error(`Failed to get display information: ${fallbackError.message}`);
    }
  }
}

/**
 * Convert display-local coordinates to global screen coordinates
 * 
 * In macOS, the coordinate system is:
 * - Main display origin is (0, 0) at bottom-left
 * - Secondary displays have origins relative to main display
 * - Y-axis increases upward in Cocoa, but cliclick uses top-left origin
 * 
 * This function converts (x, y) relative to a specific display
 * to global coordinates that cliclick can use
 */
async function convertToGlobalCoordinates(
  x: number,
  y: number,
  displayIndex: number = 0
): Promise<{ globalX: number; globalY: number }> {
  const config = await getDisplayConfiguration();
  
  // Find the target display
  const display = config.displays.find(d => d.index === displayIndex);
  if (!display) {
    throw new Error(`Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`);
  }
  
  // Validate coordinates are within display bounds
  if (x < 0 || x >= display.width || y < 0 || y >= display.height) {
    writeMCPLog(`[convertToGlobalCoordinates] Warning: Coordinates (${x}, ${y}) may be outside display ${displayIndex} bounds (${display.width}x${display.height})`, 'Coordinate Warning');
  }

  writeMCPLog(`[convertToGlobalCoordinates] Display info: width=${display.width}, height=${display.height}, originX=${display.originX}, originY=${display.originY}, scaleFactor=${display.scaleFactor}`, 'Coordinate Conversion');

  // Now originX and originY are already in cliclick coordinate system (top-left origin)
  // originX: distance from left edge of main display to left edge of this display
  // originY: distance from top edge of main display to top edge of this display
  // x, y: coordinates relative to the top-left of this display

  // Calculate global coordinates for cliclick
  const globalX = display.originX + x;
  const globalY = display.originY + y;

  writeMCPLog(`[convertToGlobalCoordinates] Input: (${x}, ${y}) + Origin: (${display.originX}, ${display.originY}) = Global: (${globalX}, ${globalY})`, 'Coordinate Conversion');

  return { globalX, globalY };
}

/**
 * Convert normalized (0-1000) coordinates to display-local logical coordinates.
 *
 * Normalized coordinates are relative to the target display:
 * - (0, 0) is top-left
 * - (1000, 1000) is bottom-right
 */
async function convertNormalizedToDisplayCoordinates(
  xNormalized: number,
  yNormalized: number,
  displayIndex: number = 0
): Promise<{ x: number; y: number }> {
  const config = await getDisplayConfiguration();

  const display = config.displays.find(d => d.index === displayIndex);
  if (!display) {
    throw new Error(`Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`);
  }

  // Clamp normalized values to [0, 1000]
  const xn = Math.max(0, Math.min(1000, xNormalized));
  const yn = Math.max(0, Math.min(1000, yNormalized));

  // Convert to display-local logical coordinates and clamp within bounds
  let x = Math.round((xn / 1000) * display.width);
  let y = Math.round((yn / 1000) * display.height);

  if (display.width > 0) x = Math.max(0, Math.min(display.width - 1, x));
  if (display.height > 0) y = Math.max(0, Math.min(display.height - 1, y));

  writeMCPLog(
    `[convertNormalizedToDisplayCoordinates] Normalized (${xNormalized}, ${yNormalized}) -> clamped (${xn}, ${yn}) -> logical (${x}, ${y}) on display ${displayIndex} (${display.width}x${display.height})`,
    'Coordinate Conversion'
  );

  return { x, y };
}

/**
 * Resolve click coordinates to display-local logical coordinates.
 * - absolute: interpret x/y directly as display-local logical coordinates
 * - normalized: interpret x/y as 0-1000 normalized coordinates
 * - auto: absolute by default; if out-of-bounds and values look normalized, convert from normalized
 */
async function resolveClickCoordinates(
  xInput: number,
  yInput: number,
  displayIndex: number = 0,
  coordinateType: 'absolute' | 'normalized' | 'auto' = 'auto'
): Promise<{ x: number; y: number }> {
  const config = await getDisplayConfiguration();
  const display = config.displays.find(d => d.index === displayIndex);

  if (!display) {
    throw new Error(`Display index ${displayIndex} not found. Available displays: 0-${config.displays.length - 1}`);
  }

  if (!Number.isFinite(xInput) || !Number.isFinite(yInput)) {
    throw new Error(`Invalid click coordinates: x=${xInput}, y=${yInput}`);
  }

  if (coordinateType === 'normalized') {
    return convertNormalizedToDisplayCoordinates(xInput, yInput, displayIndex);
  }

  let x = Math.round(xInput);
  let y = Math.round(yInput);

  if (coordinateType === 'auto') {
    const isOutOfBounds = x < 0 || y < 0 || x >= display.width || y >= display.height;
    const looksNormalized =
      xInput >= 0 && xInput <= 1000 &&
      yInput >= 0 && yInput <= 1000;

    if (isOutOfBounds && looksNormalized) {
      const converted = await convertNormalizedToDisplayCoordinates(xInput, yInput, displayIndex);
      writeMCPLog(
        `[resolveClickCoordinates] auto mode converted normalized (${xInput}, ${yInput}) -> logical (${converted.x}, ${converted.y}) on display ${displayIndex}`,
        'Coordinate Conversion'
      );
      return converted;
    }
  }

  const clampedX = display.width > 0 ? Math.max(0, Math.min(display.width - 1, x)) : x;
  const clampedY = display.height > 0 ? Math.max(0, Math.min(display.height - 1, y)) : y;

  if (clampedX !== x || clampedY !== y) {
    writeMCPLog(
      `[resolveClickCoordinates] Clamped absolute coordinates (${x}, ${y}) -> (${clampedX}, ${clampedY}) on display ${displayIndex}`,
      'Coordinate Conversion'
    );
  }

  return { x: clampedX, y: clampedY };
}

// ============================================================================
// GUI Operation Functions
// ============================================================================

/**
 * Perform a click operation
 */
async function performClick(
  x: number,
  y: number,
  displayIndex: number = 0,
  clickType: 'single' | 'double' | 'right' | 'triple' = 'single',
  modifiers: string[] = []
): Promise<string> {
  writeMCPLog(`[performClick] Input coordinates: x=${x}, y=${y}, displayIndex=${displayIndex}, clickType=${clickType}`, 'Click Operation');

  // If server restarted, in-memory click history/app context is empty. Try to restore last app context
  // so click history persistence + screenshot annotation remain stable without requiring an explicit init_app retry.
  if (!currentAppName && clickHistory.length === 0) {
    await ensureAppContextRestored();
  }

  let localX = x;
  let localY = y;

  // Dock auto-hide on macOS can swallow the first click near the bottom edge.
  // Pre-hovering briefly improves click reliability for dock/app-switch actions.
  if (PLATFORM === 'darwin') {
    const config = await getDisplayConfiguration();
    const targetDisplay = config.displays.find(d => d.index === displayIndex);
    const dockZoneHeight = 140;
    const nearBottomDockZone = Boolean(
      targetDisplay && localY >= Math.max(0, targetDisplay.height - dockZoneHeight)
    );

    if (targetDisplay && localY >= targetDisplay.height - 2) {
      localY = Math.max(0, targetDisplay.height - 24);
      writeMCPLog(
        `[performClick] Adjusted edge click Y from ${y} to ${localY} for dock reliability on display ${displayIndex}`,
        'Click Operation'
      );
    }

    if (nearBottomDockZone) {
      await moveMouse(localX, localY, displayIndex);
      await new Promise(resolve => setTimeout(resolve, 150));
      writeMCPLog(
        `[performClick] Pre-hovered in dock zone before click at (${localX}, ${localY})`,
        'Click Operation'
      );
    }
  }

  const { globalX, globalY } = await convertToGlobalCoordinates(localX, localY, displayIndex);

  writeMCPLog(`[performClick] Global coordinates: globalX=${globalX}, globalY=${globalY}`, 'Click Operation');

  // Windows implementation
  if (PLATFORM === 'win32') {
    await windowsPerformClick(globalX, globalY, clickType, modifiers);
    await addClickToHistory(localX, localY, displayIndex, clickType);
    return `Performed ${clickType} click at (${localX}, ${localY}) on display ${displayIndex} (global: ${globalX}, ${globalY})`;
  }

  // macOS implementation using cliclick
  const normalizedModifiers = normalizeModifierKeys(modifiers);
  const cliclickPath = await resolveCliclickPath();

  if (!cliclickPath) {
    // 无 cliclick 时，使用 Quartz 事件作为降级方案
    await performMacClickViaQuartz(globalX, globalY, clickType, normalizedModifiers);
    await addClickToHistory(localX, localY, displayIndex, clickType);
    return `Performed ${clickType} click at (${localX}, ${localY}) on display ${displayIndex} (global: ${globalX}, ${globalY})`;
  }

  // Build cliclick command
  let command = '';
  
  // Add modifiers (if any)
  const cliclickModifiers = normalizedModifiers.join(',');
  
  // Build click command based on type
  switch (clickType) {
    case 'double':
      command = `dc:${globalX},${globalY}`;
      break;
    case 'right':
      command = `rc:${globalX},${globalY}`;
      break;
    case 'triple':
      command = `tc:${globalX},${globalY}`;
      break;
    case 'single':
    default:
      command = `c:${globalX},${globalY}`;
      break;
  }
  
  // Add modifier key handling
  if (cliclickModifiers) {
    // Hold modifier keys, click, release
    command = `kd:${cliclickModifiers} ${command} ku:${cliclickModifiers}`;
  }
  
  await executeCliclick(command);
  
  // Add to click history after successful click (now async with persistence)
  await addClickToHistory(localX, localY, displayIndex, clickType);
  
  return `Performed ${clickType} click at (${localX}, ${localY}) on display ${displayIndex} (global: ${globalX}, ${globalY})`;
}

/**
 * Perform keyboard input
 */
async function performType(
  text: string,
  pressEnter: boolean = false,
  inputMethod: 'auto' | 'keystroke' | 'paste' = 'auto',
  preserveClipboard: boolean = true
): Promise<string> {
  // Windows implementation
  if (PLATFORM === 'win32') {
    writeMCPLog(
      `[performType] Windows: Typing text. text length: ${text.length}`,
      'Type Operation'
    );
    await windowsPerformType(text, pressEnter);
    return `Typed: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"${pressEnter ? ' and pressed Enter' : ''}`;
  }

  // macOS implementation
  const hasNonAscii = /[^\x00-\x7F]/.test(text);
  const usePaste = inputMethod === 'paste' || (inputMethod === 'auto' && hasNonAscii);

  // Clipboard-paste method is much more reliable for Unicode/CJK (e.g. Chinese)
  if (usePaste) {
    writeMCPLog(
      `[performType] Typing via clipboard paste (unicode-safe). text length: ${text.length}, preserveClipboard=${preserveClipboard}`,
      'Type Operation'
    );

    // Snapshot current clipboard bytes so we can restore it after paste (best-effort).
    let previousClipboardBytes: Buffer | null = null;
    if (preserveClipboard) {
      try {
        previousClipboardBytes = await macReadClipboardBytes(2000);
      } catch {
        // If pbpaste fails (non-text clipboard, permissions, etc.), skip restore
        previousClipboardBytes = null;
      }
    }

    // Set clipboard to the target text (as bytes) without requiring Python.
    await macWriteClipboardBytes(Buffer.from(text, 'utf-8'), 5000);

    // Paste (Cmd+V)
    await performKeyPress('v', ['cmd']);

    // Optionally press Enter
    if (pressEnter) {
      await executeCommand(`osascript -e 'tell application "System Events" to key code 36'`);
    }

    // Restore previous clipboard if we captured it (best-effort).
    // Limit size to avoid excessive memory / IPC overhead.
    if (preserveClipboard && previousClipboardBytes && previousClipboardBytes.length <= 10 * 1024 * 1024) {
      try {
        await macWriteClipboardBytes(previousClipboardBytes, 5000);
      } catch {
        // Best-effort restore
      }
    }

    return `Typed (paste): "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"${pressEnter ? ' and pressed Enter' : ''}`;
  }

  // Default: AppleScript keystroke for ASCII text
  const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const appleScript = `tell application "System Events" to keystroke "${escapedText}"`;

  writeMCPLog(
    `[performType] Typing via AppleScript keystroke. text length: ${text.length}, inputMethod=${inputMethod}`,
    'Type Operation'
  );
  await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);

  if (pressEnter) {
    await executeCommand(`osascript -e 'tell application "System Events" to key code 36'`);
  }

  return `Typed: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"${pressEnter ? ' and pressed Enter' : ''}`;
}

/**
 * Press a key or key combination
 */
async function performKeyPress(
  key: string,
  modifiers: string[] = []
): Promise<string> {
  // Log input parameters for debugging
  writeMCPLog(`[performKeyPress] Input: key="${key}", modifiers=${JSON.stringify(modifiers)}`, 'Key Press Debug');
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    await windowsPerformKeyPress(key, modifiers);
    const modifierStr = modifiers.length > 0 ? `${modifiers.join('+')}+` : '';
    return `Pressed: ${modifierStr}${key}`;
  }

  // macOS implementation
  // Map common key names to cliclick key codes
  const keyMap: Record<string, string> = {
    'enter': 'return',
    'return': 'return',
    'tab': 'tab',
    'escape': 'esc',
    'esc': 'esc',
    'space': 'space',
    'delete': 'delete',
    'backspace': 'delete',
    'up': 'arrow-up',
    'down': 'arrow-down',
    'left': 'arrow-left',
    'right': 'arrow-right',
    'home': 'home',
    'end': 'end',
    'pageup': 'page-up',
    'pagedown': 'page-down',
    'f1': 'f1',
    'f2': 'f2',
    'f3': 'f3',
    'f4': 'f4',
    'f5': 'f5',
    'f6': 'f6',
    'f7': 'f7',
    'f8': 'f8',
    'f9': 'f9',
    'f10': 'f10',
    'f11': 'f11',
    'f12': 'f12',
  };
  
  // Map characters to AppleScript key codes (for reliable modifier+key combinations)
  const keyCodeMap: Record<string, number> = {
    'a': 0, 'b': 11, 'c': 8, 'd': 2, 'e': 14, 'f': 3, 'g': 5, 'h': 4,
    'i': 34, 'j': 38, 'k': 40, 'l': 37, 'm': 46, 'n': 45, 'o': 31, 'p': 35,
    'q': 12, 'r': 15, 's': 1, 't': 17, 'u': 32, 'v': 9, 'w': 13, 'x': 7,
    'y': 16, 'z': 6,
    '0': 29, '1': 18, '2': 19, '3': 20, '4': 21, '5': 23,
    '6': 22, '7': 26, '8': 28, '9': 25,
    ' ': 49, // space
  };
  
  const specialKeyCodeMap: Record<string, number> = {
    'enter': 36,
    'return': 36,
    'tab': 48,
    'escape': 53,
    'esc': 53,
    'space': 49,
    'delete': 51,
    'backspace': 51,
    'up': 126,
    'down': 125,
    'left': 123,
    'right': 124,
    'home': 115,
    'end': 119,
    'pageup': 116,
    'pagedown': 121,
    'f1': 122,
    'f2': 120,
    'f3': 99,
    'f4': 118,
    'f5': 96,
    'f6': 97,
    'f7': 98,
    'f8': 100,
    'f9': 101,
    'f10': 109,
    'f11': 103,
    'f12': 111,
  };
  
  const keyLower = key.toLowerCase();
  const cliclickKey = keyMap[keyLower];
  
  // Handle modifiers
  const cliclickModifiers = normalizeModifierKeys(modifiers);
  
  writeMCPLog(`[performKeyPress] Mapped modifiers: ${JSON.stringify(cliclickModifiers)}`, 'Key Press Debug');
  const hasCliclick = Boolean(await resolveCliclickPath());
  
  let command = '';
  let resultMessage = '';
  
  // If key is in keyMap, use kp: command for special keys
  if (cliclickKey) {
    if (hasCliclick) {
      if (cliclickModifiers.length > 0) {
        command = `kd:${cliclickModifiers.join(',')} kp:${cliclickKey} ku:${cliclickModifiers.join(',')}`;
      } else {
        command = `kp:${cliclickKey}`;
      }
      await executeCliclick(command);
    } else {
      // 无 cliclick 时，使用 AppleScript key code 方案
      const keyCode = specialKeyCodeMap[keyLower];
      if (keyCode === undefined) {
        throw new Error(
          `Key "${key}" requires cliclick on macOS. ` +
          `Please install/bundle cliclick or use a supported single character key.`
        );
      }
      const modifierFlags: string[] = [];
      if (cliclickModifiers.includes('cmd')) modifierFlags.push('command down');
      if (cliclickModifiers.includes('ctrl')) modifierFlags.push('control down');
      if (cliclickModifiers.includes('shift')) modifierFlags.push('shift down');
      if (cliclickModifiers.includes('alt')) modifierFlags.push('option down');
      const usingClause = modifierFlags.length > 0 ? ` using {${modifierFlags.join(', ')}}` : '';
      const appleScript = `tell application "System Events" to key code ${keyCode}${usingClause}`;
      await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
      const modifierStr = modifiers.join('+');
      resultMessage = `Pressed: ${modifierStr ? `${modifierStr}+` : ''}${key} (using key code)`;
    }
  } else {
    // For single characters, cliclick's kp: doesn't work, use t: command instead
    if (key.length === 1) {
      const escapedKey = key.replace(/"/g, '\\"');
      
      if (cliclickModifiers.length > 0) {
        // For modifier+char combinations, use AppleScript key code for reliability
        // This is especially important for system shortcuts like Ctrl+C
        const keyCode = keyCodeMap[keyLower];
        
        if (keyCode !== undefined) {
          // Use key code method for reliable modifier combinations
          const modifierFlags: string[] = [];
          if (cliclickModifiers.includes('cmd')) modifierFlags.push('command down');
          if (cliclickModifiers.includes('ctrl')) modifierFlags.push('control down');
          if (cliclickModifiers.includes('shift')) modifierFlags.push('shift down');
          if (cliclickModifiers.includes('alt')) modifierFlags.push('option down');
          
          const usingClause = modifierFlags.length > 0 ? ` using {${modifierFlags.join(', ')}}` : '';
          const appleScript = `tell application "System Events" to key code ${keyCode}${usingClause}`;
          
          writeMCPLog(`[performKeyPress] Using key code ${keyCode} for ${key} with modifiers: ${modifierFlags.join(', ')}`, 'Key Press');
          await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
          const modifierStr = modifiers.join('+');
          resultMessage = `Pressed: ${modifierStr}+${key} (using key code)`;
        } else {
          // Fallback to keystroke for characters not in keyCodeMap
          const modifierFlags: string[] = [];
          if (cliclickModifiers.includes('cmd')) modifierFlags.push('command down');
          if (cliclickModifiers.includes('ctrl')) modifierFlags.push('control down');
          if (cliclickModifiers.includes('shift')) modifierFlags.push('shift down');
          if (cliclickModifiers.includes('alt')) modifierFlags.push('option down');
          
          const usingClause = modifierFlags.length > 0 ? ` using {${modifierFlags.join(', ')}}` : '';
          const appleScript = `tell application "System Events" to keystroke "${escapedKey}"${usingClause}`;
          
          await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
          const modifierStr = modifiers.join('+');
          resultMessage = `Pressed: ${modifierStr}+${key} (using keystroke)`;
        }
      } else {
        // No modifiers
        if (hasCliclick) {
          command = `t:"${escapedKey}"`;
          await executeCliclick(command);
        } else {
          const appleScript = `tell application "System Events" to keystroke "${escapedKey}"`;
          await executeCommand(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
          resultMessage = `Pressed: ${key} (using keystroke)`;
        }
      }
    } else {
      // Multi-character key name not in keyMap - this is an error
      throw new Error(
        `Unknown key: "${key}". ` +
        `Supported special keys: ${Object.keys(keyMap).join(', ')}, ` +
        `or single characters (a-z, 0-9, etc.) for typing text.`
      );
    }
  }
  
  if (resultMessage) {
    return resultMessage;
  }
  
  const modifierStr = modifiers.length > 0 ? `${modifiers.join('+')}+` : '';
  return `Pressed: ${modifierStr}${key}`;
}

/**
 * Perform scroll operation
 */
async function performScroll(
  x: number,
  y: number,
  displayIndex: number = 0,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 3
): Promise<string> {
  const { globalX, globalY } = await convertToGlobalCoordinates(x, y, displayIndex);
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    await windowsPerformScroll(globalX, globalY, direction, amount);
    return `Scrolled ${direction} by ${amount} at (${x}, ${y}) on display ${displayIndex}`;
  }

  // macOS implementation
  // First move to the position
  const moveCommand = `m:${globalX},${globalY}`;
  const hasCliclick = Boolean(await resolveCliclickPath());
  
  // cliclick doesn't directly support scrolling, but we can use AppleScript
  // via osascript for more reliable scrolling
  if (hasCliclick) {
    await executeCliclick(moveCommand);
  } else {
    await performMacMouseMoveViaQuartz(globalX, globalY, []);
  }
  
  // Use Python with pyobjc for scrolling via CGEventCreateScrollWheelEvent
  // This is the most reliable method for programmatic scrolling on macOS
  const scrollY = direction === 'up' ? amount : direction === 'down' ? -amount : 0;
  const scrollX = direction === 'left' ? amount : direction === 'right' ? -amount : 0;
  
  const scrollScript = `
import Quartz
event = Quartz.CGEventCreateScrollWheelEvent(None, Quartz.kCGScrollEventUnitLine, 2, ${scrollY}, ${scrollX})
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
  `.trim().replace(/\n/g, '; ');
  
  try {
    await executePython(scrollScript, 5000);
  } catch {
    // Fallback: try using AppleScript with key simulation
    // This is a rough approximation for systems without pyobjc
    const keyCode = direction === 'up' ? '126' : direction === 'down' ? '125' : direction === 'left' ? '123' : '124';
    const repeatCount = Math.min(amount, 10);
    
    for (let i = 0; i < repeatCount; i++) {
      try {
        await executeCommand(`osascript -e 'tell application "System Events" to key code ${keyCode}'`);
      } catch {
        break;
      }
    }
    console.warn('Python scroll failed, using key-based approximation');
  }
  
  return `Scrolled ${direction} by ${amount} at (${x}, ${y}) on display ${displayIndex}`;
}

/**
 * Perform drag operation
 */
async function performDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  displayIndex: number = 0
): Promise<string> {
  const fromCoords = await convertToGlobalCoordinates(fromX, fromY, displayIndex);
  const toCoords = await convertToGlobalCoordinates(toX, toY, displayIndex);
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    await windowsPerformDrag(fromCoords.globalX, fromCoords.globalY, toCoords.globalX, toCoords.globalY);
    return `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}) on display ${displayIndex}`;
  }

  // macOS implementation
  // cliclick drag command: dd: (drag down/start) then du: (drag up/end)
  const command = `dd:${fromCoords.globalX},${fromCoords.globalY} du:${toCoords.globalX},${toCoords.globalY}`;
  const hasCliclick = Boolean(await resolveCliclickPath());
  
  if (hasCliclick) {
    await executeCliclick(command);
  } else {
    await performMacDragViaQuartz(
      fromCoords.globalX,
      fromCoords.globalY,
      toCoords.globalX,
      toCoords.globalY,
      []
    );
  }
  
  return `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY}) on display ${displayIndex}`;
}

/**
 * Take a screenshot
 */
async function takeScreenshot(
  outputPath?: string,
  displayIndex?: number,
  region?: { x: number; y: number; width: number; height: number }
): Promise<string> {
  const timestamp = Date.now();
  const defaultPath = path.join(SCREENSHOTS_DIR, `screenshot_${timestamp}.png`);
  const finalPath = outputPath || defaultPath;

  // Ensure the directory exists
  const dir = path.dirname(finalPath);
  await fs.mkdir(dir, { recursive: true });

  // Windows implementation
  if (PLATFORM === 'win32') {
    // Convert region coordinates to global if needed
    let globalRegion = region;
    if (region && displayIndex !== undefined) {
      const { globalX, globalY } = await convertToGlobalCoordinates(region.x, region.y, displayIndex);
      globalRegion = { x: globalX, y: globalY, width: region.width, height: region.height };
    }
    
    await windowsTakeScreenshot(finalPath, displayIndex, globalRegion);
    
    // Verify the file was created
    try {
      await fs.access(finalPath);
      const stats = await fs.stat(finalPath);
      return JSON.stringify({
        success: true,
        path: finalPath,
        size: stats.size,
        displayIndex: displayIndex ?? 'all',
        timestamp: new Date().toISOString(),
      });
    } catch {
      throw new Error(`Screenshot file was not created at ${finalPath}`);
    }
  }

  // macOS implementation
  // Use absolute path because packaged apps may have a limited PATH.
  let command = '/usr/sbin/screencapture -C';

  // -x: no sound
  command += ' -x';

  // If specific display requested
  if (displayIndex !== undefined) {
    const config = await getDisplayConfiguration();
    const display = config.displays.find(d => d.index === displayIndex);

    if (!display) {
      throw new Error(`Display index ${displayIndex} not found.`);
    }

    // -D: capture specific display (1-indexed for screencapture)
    command += ` -D ${displayIndex + 1}`;
  }

  // If region specified
  if (region) {
    const { globalX, globalY } = displayIndex !== undefined
      ? await convertToGlobalCoordinates(region.x, region.y, displayIndex)
      : { globalX: region.x, globalY: region.y };

    // -R: capture specific region (x,y,width,height)
    command += ` -R ${globalX},${globalY},${region.width},${region.height}`;
  }

  command += ` "${finalPath}"`;

  try {
  await executeCommand(command);
  } catch (error: any) {
    const baseMessage = error?.message || String(error);
    const hint =
      '\n\nmacOS 权限提示 / Permissions:\n' +
      '- System Settings → Privacy & Security → Screen Recording：允许 Open Cowork\n' +
      '- 重新启动应用后再试 / Restart the app and try again\n';
    throw new Error(`${baseMessage}${hint}`);
  }

  // Verify the file was created
  try {
    await fs.access(finalPath);

    // Get file info
    const stats = await fs.stat(finalPath);

    return JSON.stringify({
      success: true,
      path: finalPath,
      size: stats.size,
      displayIndex: displayIndex ?? 'all',
      timestamp: new Date().toISOString(),
    });
  } catch {
    throw new Error(`Screenshot file was not created at ${finalPath}`);
  }
}

/**
 * Take a screenshot and return it with base64 image data for display in the response
 */
async function takeScreenshotForDisplay(
  displayIndex?: number,
  region?: { x: number; y: number; width: number; height: number },
  reason?: string,
  forceRefresh?: boolean,
  // annotateClicks?: boolean
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  const normalizedDisplayIndex = displayIndex ?? 0;
  const regionKey = toRegionKey(region);
  const requestKey = `${normalizedDisplayIndex}:${regionKey}`;
  const requestCount = (screenshotRequestCounts.get(requestKey) || 0) + 1;
  screenshotRequestCounts.set(requestKey, requestCount);
  const reusable = forceRefresh ? null : getReusableScreenshot(normalizedDisplayIndex, regionKey);
  if (reusable) {
    const reusedMetadata: Record<string, any> = {
      success: true,
      path: reusable.path,
      displayIndex: reusable.displayIndex,
      displayInfo: reusable.displayInfo,
      timestamp: new Date(reusable.capturedAt).toISOString(),
      reused: true,
      duplicateCallCount: requestCount,
    };
    if (requestCount > 1) {
      reusedMetadata.nextStepHint =
        'Screenshot already captured recently. Please use this screenshot to interpret/verify, and avoid repeated screenshot_for_display calls unless user explicitly asks to refresh.';
    }
    if (reason) {
      reusedMetadata.reason = reason;
    }
    if (region) {
      reusedMetadata.region = region;
    }
    writeMCPLog(
      `[takeScreenshotForDisplay] Reusing screenshot captured ${Date.now() - reusable.capturedAt}ms ago: ${reusable.path} (duplicateCallCount=${requestCount})`,
      'Screenshot Reuse'
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(reusedMetadata, null, 2),
        },
        {
          type: 'image',
          data: reusable.base64Image,
          mimeType: 'image/png',
        },
      ],
    };
  }

  const timestamp = Date.now();
  const tempPath = path.join(SCREENSHOTS_DIR, `screenshot_display_${timestamp}.png`);

  // Take the screenshot first
  await takeScreenshot(tempPath, displayIndex, region);

  let finalPath = tempPath;
  // let clickHistoryInfo: string | undefined;

  // // Annotate with click history if requested
  // if (annotateClicks && currentAppName) {
  //   try {
  //     const annotateResult = await annotateScreenshotWithClickHistory(
  //       tempPath,
  //       displayIndex ?? 0
  //     );
  //     finalPath = annotateResult.annotatedPath;
  //     clickHistoryInfo = annotateResult.clickHistoryInfo;
  //   } catch (error) {
  //     writeMCPLog(`[takeScreenshotForDisplay] Failed to annotate screenshot: ${error}`, 'Screenshot');
  //     // Continue with un-annotated screenshot
  //   }
  // }

  // Read the screenshot file and convert to base64
  const imageBuffer = await fs.readFile(finalPath);
  const base64Image = imageBuffer.toString('base64');

  // Get display information
  const config = await getDisplayConfiguration();
  const display = config.displays.find(d => d.index === normalizedDisplayIndex) || config.displays[0];

  // Build response metadata
  const metadata: Record<string, any> = {
    success: true,
    path: finalPath,
    displayIndex: normalizedDisplayIndex,
    displayInfo: {
      width: display.width,
      height: display.height,
      scaleFactor: display.scaleFactor,
    },
    timestamp: new Date().toISOString(),
    // annotated: annotateClicks && currentAppName ? true : false,
  };

  if (reason) {
    metadata.reason = reason;
  }

  if (forceRefresh) {
    metadata.forceRefresh = true;
  }

  if (region) {
    metadata.region = region;
  }

  const disableImageOutput = process.env.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT === '1';
  if (disableImageOutput) {
    metadata.imageOmitted = true;
    metadata.omitReason = 'provider_does_not_support_image';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(metadata, null, 2),
        },
      ],
    };
  }

  // if (clickHistoryInfo) {
  //   metadata.clickHistoryInfo = clickHistoryInfo;
  // }

  updateScreenshotCache({
    displayIndex: normalizedDisplayIndex,
    regionKey,
    path: finalPath,
    base64Image,
    capturedAt: Date.now(),
    displayInfo: {
      width: display.width,
      height: display.height,
      scaleFactor: display.scaleFactor,
    },
  });

  // Return MCP response with both text and image content
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(metadata, null, 2),
      },
      {
        type: 'image',
        data: base64Image,
        mimeType: 'image/png',
      },
    ],
  };
}

/**
 * Get current mouse position
 */
async function getMousePosition(): Promise<{ x: number; y: number; displayIndex: number }> {
  let globalX: number;
  let globalY: number;
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    const pos = await windowsGetMousePosition();
    globalX = pos.globalX;
    globalY = pos.globalY;
  } else {
    // macOS implementation
    const result = await executeCliclick('p');
    // Output format: "x,y" or similar
    const match = result.stdout.trim().match(/(\d+),(\d+)/);
    
    if (!match) {
      throw new Error(`Failed to parse mouse position: ${result.stdout}`);
    }
    
    globalX = parseInt(match[1]);
    globalY = parseInt(match[2]);
  }
  
  // Find which display this position is on
  const config = await getDisplayConfiguration();
  let foundDisplay = config.displays[0];
  
  for (const display of config.displays) {
    if (
      globalX >= display.originX &&
      globalX < display.originX + display.width &&
      globalY >= display.originY &&
      globalY < display.originY + display.height
    ) {
      foundDisplay = display;
      break;
    }
  }
  
  // Convert to display-local coordinates
  const localX = globalX - foundDisplay.originX;
  const localY = globalY - foundDisplay.originY;
  
  return {
    x: localX,
    y: localY,
    displayIndex: foundDisplay.index,
  };
}

/**
 * Move mouse to position
 */
async function moveMouse(
  x: number,
  y: number,
  displayIndex: number = 0
): Promise<string> {
  const { globalX, globalY } = await convertToGlobalCoordinates(x, y, displayIndex);
  
  // Windows implementation
  if (PLATFORM === 'win32') {
    await windowsMoveMouse(globalX, globalY);
    return `Moved mouse to (${x}, ${y}) on display ${displayIndex}`;
  }
  
  // macOS implementation
  const hasCliclick = Boolean(await resolveCliclickPath());
  if (hasCliclick) {
    await executeCliclick(`m:${globalX},${globalY}`);
  } else {
    await performMacMouseMoveViaQuartz(globalX, globalY, []);
  }
  
  return `Moved mouse to (${x}, ${y}) on display ${displayIndex}`;
}

/**
 * Wait for a specified duration
 */
async function performWait(
  duration: number,
  reason?: string
): Promise<string> {
  const startTime = Date.now();
  
  writeMCPLog(`[performWait] Waiting for ${duration}ms${reason ? `: ${reason}` : ''}`, 'Wait Operation');
  
  await new Promise(resolve => setTimeout(resolve, duration));
  
  const actualDuration = Date.now() - startTime;
  writeMCPLog(`[performWait] Wait completed. Actual duration: ${actualDuration}ms`, 'Wait Operation');
  
  return `Waited for ${actualDuration}ms${reason ? ` (${reason})` : ''}`;
}

// ============================================================================
// Vision-based GUI Operations
// ============================================================================

/**
 * Call vision API to analyze images with timeout and retry
 */
async function callVisionAPI(
  base64Image: string,
  prompt: string,
  maxTokens: number = 2048,
  functionName?: string
): Promise<string> {
  const MAX_RETRIES = 3;
  const TIMEOUT_MS = 45000; // 45 seconds
  
  const logPrefix = functionName ? `[callVisionAPI:${functionName}]` : '[callVisionAPI]';
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Starting API call`, 'API Request');
      
      const result = await callVisionAPIWithTimeout(base64Image, prompt, maxTokens, functionName, TIMEOUT_MS);
      
      writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Success`, 'API Request');
      return result;
    } catch (error: any) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const errorMessage = String(error?.message || error || '');

      // Deterministic request-shape errors should fail fast instead of wasting retries.
      if (
        errorMessage.includes('Unsupported parameter') ||
        errorMessage.includes('Instructions are required') ||
        errorMessage.includes('Stream must be set to true')
      ) {
        writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Deterministic error, stop retry: ${errorMessage}`, 'API Request Error');
        throw new Error(errorMessage);
      }
      
      if (errorMessage.includes('timeout')) {
        writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Timeout after ${TIMEOUT_MS}ms`, 'API Request Error');
      } else {
        writeMCPLog(`${logPrefix} Attempt ${attempt}/${MAX_RETRIES} - Error: ${errorMessage}`, 'API Request Error');
      }
      
      if (isLastAttempt) {
        writeMCPLog(`${logPrefix} All ${MAX_RETRIES} attempts failed`, 'API Request Failed');
        throw new Error(`Vision API failed after ${MAX_RETRIES} attempts: ${errorMessage}`);
      }
      
      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      const waitTime = Math.pow(2, attempt - 1) * 1000;
      writeMCPLog(`${logPrefix} Waiting ${waitTime}ms before retry...`, 'API Request Retry');
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error('Vision API failed: Maximum retries exceeded');
}

function getBaseUrlHost(baseUrl: string | undefined): string {
  if (!baseUrl) {
    return '(unset)';
  }
  try {
    return new URL(baseUrl).host || '(unknown)';
  } catch {
    return '(invalid-url)';
  }
}

function buildVisionRuntimeSummary(
  functionName: string | undefined,
  anthropicApiKey: string | undefined,
  openAIApiKey: string | undefined,
  baseUrl: string | undefined,
  model: string,
  isOpenAICompatible: boolean,
  isCodexBackend: boolean
): Record<string, unknown> {
  return {
    functionName: functionName || '(unknown)',
    hasAnthropicApiKey: Boolean(anthropicApiKey),
    hasOpenAIApiKey: Boolean(openAIApiKey),
    hasAnyApiKey: Boolean(anthropicApiKey || openAIApiKey),
    baseUrlHost: getBaseUrlHost(baseUrl),
    model,
    isOpenAICompatible,
    isCodexBackend,
  };
}

/**
 * Call vision API with timeout
 */
async function callVisionAPIWithTimeout(
  base64Image: string,
  prompt: string,
  maxTokens: number,
  functionName: string | undefined,
  timeoutMs: number
): Promise<string> {
  // Get API configuration from environment (supports Anthropic/OpenRouter/OpenAI-compatible)
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const apiKey = anthropicApiKey || openAIApiKey;
  const hasOpenAIConfig = Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL);
  const baseUrl = process.env.ANTHROPIC_BASE_URL || process.env.OPENAI_BASE_URL;
  const model =
    process.env.CLAUDE_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    process.env.OPENAI_MODEL ||
    'claude-3-5-sonnet-20241022';

  // Check if using OpenRouter
  const isOpenRouter = !!baseUrl && (baseUrl.includes('openrouter.ai') || baseUrl.includes('openrouter'));
  
  // Check if model/config is OpenAI-compatible (Gemini, GPT, etc.)
  const isOpenAICompatible =
    hasOpenAIConfig ||
    model.includes('gemini') ||
    model.includes('gpt-') ||
    model.includes('openai/') ||
    isOpenRouter ||
    (baseUrl ? baseUrl.includes('api.openai.com') : false);

  const isCodexBackend = Boolean(baseUrl && baseUrl.includes('chatgpt.com/backend-api/codex'));
  const runtimeSummary = buildVisionRuntimeSummary(
    functionName,
    anthropicApiKey,
    openAIApiKey,
    baseUrl,
    model,
    isOpenAICompatible,
    isCodexBackend
  );
  writeMCPLog(JSON.stringify(runtimeSummary), 'Vision Runtime');

  const selectedRoute = isOpenAICompatible
    ? (isCodexBackend ? 'codex-responses' : 'openai-chat-completions')
    : 'anthropic-messages';
  writeMCPLog(
    `[Vision Routing] function=${functionName || '(unknown)'} route=${selectedRoute} host=${getBaseUrlHost(baseUrl)} model=${model}`,
    'Vision Routing'
  );

  if (!apiKey) {
    throw new Error('API key not configured. Please set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY.');
  }
  
  if (isOpenAICompatible) {
    if (isCodexBackend) {
      return await callCodexVisionResponses(
        base64Image,
        prompt,
        model,
        baseUrl!,
        apiKey,
        process.env.OPENAI_ACCOUNT_ID,
        timeoutMs
      );
    }

    // Use OpenAI-compatible API format (for Gemini, GPT, etc. via OpenRouter)
    const openAIBaseUrl = baseUrl || 'https://api.openai.com/v1';
    const openAIUrl = openAIBaseUrl.endsWith('/v1') 
      ? `${openAIBaseUrl}/chat/completions`
      : `${openAIBaseUrl}/v1/chat/completions`;
    
    // Use Node.js built-in https module for better compatibility
    const https = require('https');
    const http = require('http');
    const url = require('url');
    
    const urlObj = new url.URL(openAIUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestBodyObj: any = {
      model: model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: maxTokens,
    };
    
    const requestBody = JSON.stringify(requestBodyObj);
    
    const headers: any = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(requestBody),
    };
    
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://github.com/OpenCoworkAI/open-cowork';
      headers['X-Title'] = 'Open Cowork';
    }
    
    return new Promise<string>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      let isResolved = false;
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: headers,
        timeout: timeoutMs,
      };
      
      const req = httpModule.request(options, (res: any) => {
        let data = '';
        
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        
        res.on('end', () => {
          if (isResolved) return;
          clearTimeout(timeoutId);
          
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              writeMCPLog(`[callVisionAPIWithTimeout] Response received, length: ${data.length}`, 'API Response');
              const jsonData = JSON.parse(data);
              const responseContent = jsonData.choices[0]?.message?.content || '';
              
              // Log the response
              const logLabel = functionName ? `Vision API Response [${functionName}]` : 'Vision API Response';
              writeMCPLog(responseContent, logLabel);
              
              isResolved = true;
              resolve(responseContent);
            } catch (e: any) {
              isResolved = true;
              reject(new Error(`Failed to parse API response: ${e.message}`));
            }
          } else {
            isResolved = true;
            reject(new Error(`API request failed: ${res.statusCode} ${res.statusMessage} - ${data}`));
          }
        });
      });
      
      // Set timeout
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          req.destroy();
          reject(new Error(`API request timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      
      req.on('error', (error: Error) => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        reject(new Error(`API request error: ${error.message}`));
      });
      
      req.on('timeout', () => {
        if (isResolved) return;
        clearTimeout(timeoutId);
        isResolved = true;
        req.destroy();
        reject(new Error(`API request timeout after ${timeoutMs}ms`));
      });
      
      req.write(requestBody);
      req.end();
    });
  } else {
    // Use Anthropic API format
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({
      apiKey: apiKey,
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
    
    // Wrap the API call with timeout promise
    const apiCallPromise = anthropic.messages.create({
      model: model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`API request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    try {
      const message = await Promise.race([apiCallPromise, timeoutPromise]);
      
      const responseContent = message.content[0].type === 'text' ? message.content[0].text : '';
      
      // Log the response
      const logLabel = functionName ? `Vision API Response [${functionName}]` : 'Vision API Response';
      writeMCPLog(responseContent, logLabel);
      writeMCPLog(`[callVisionAPIWithTimeout] Response received, length: ${responseContent.length}`, 'API Response');
      
      return responseContent;
    } catch (error: any) {
      if (error.message.includes('timeout')) {
        throw new Error(`API request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}

async function callCodexVisionResponses(
  base64Image: string,
  prompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  accountId: string | undefined,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/responses`;
    const instructions =
      'You are a GUI vision assistant. Analyze the provided screenshot and answer the user question accurately and concisely. Use Chinese unless the user explicitly requests another language.';
    const question = (prompt || '').trim() || 'Please describe what is visible in the screenshot.';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'CodexBar',
        ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        instructions,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: question },
              { type: 'input_image', image_url: `data:image/png;base64,${base64Image}` },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${bodyText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream') || bodyText.includes('event:') || bodyText.includes('data:')) {
      const streamedText = extractTextFromResponsesSSE(bodyText);
      if (streamedText.trim()) {
        return streamedText;
      }
      throw new Error('Vision SSE response did not contain output text');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(bodyText);
    } catch (error: any) {
      throw new Error(`Failed to parse API response: ${error.message}`);
    }

    const directText = extractOutputTextFromResponsesPayload(parsed);
    if (directText.trim()) {
      return directText;
    }

    throw new Error('Vision response did not contain output text');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Annotate screenshot with click history markers
 * Returns path to annotated image and click history info
 */
async function annotateScreenshotWithClickHistory(
  screenshotPath: string,
  displayIndex: number
): Promise<{ annotatedPath: string; clickHistoryInfo: string }> {
  // If server restarted, restore last app context so click history markers are available.
  if (!currentAppName && clickHistory.length === 0) {
    await ensureAppContextRestored();
  }

  // Debug: Log the full click history array
  writeMCPLog(`[annotateScreenshot] Total clicks in history: ${clickHistory.length}`, 'Click History Debug');
  writeMCPLog(`[annotateScreenshot] Full click history: ${JSON.stringify(clickHistory)}`, 'Click History Debug');
  writeMCPLog(`[annotateScreenshot] Requested displayIndex: ${displayIndex}`, 'Click History Debug');
  
  const clickHistoryForDisplay = getClickHistoryForDisplay(displayIndex);
  
  writeMCPLog(`[annotateScreenshot] Filtered clicks for display ${displayIndex}: ${clickHistoryForDisplay.length}`, 'Click History Debug');
  
  if (clickHistoryForDisplay.length === 0) {
    // No click history, return original path
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo: 'No previous clicks recorded.',
    };
  }
  
  // Create annotated image path
  const timestamp = Date.now();
  const basename = path.basename(screenshotPath, '.png');
  const annotatedPath = path.join(
    path.dirname(screenshotPath),
    `${basename}_annotated_${timestamp}.png`
  );
  
  // Get image dimensions to calculate normalized coordinates
  const imageDims = await getImageDimensions(screenshotPath);
  
  // Get display configuration to handle Retina scaling
  const config = await getDisplayConfiguration();
  const targetDisplay = config.displays.find(d => d.index === displayIndex);
  const scaleFactor = targetDisplay?.scaleFactor || 1;
  
  writeMCPLog(`[annotateScreenshot] Image dimensions: ${imageDims.width}x${imageDims.height}, scaleFactor: ${scaleFactor}`, 'Image Info');
  
  // Find the most recent click (highest timestamp) to display as #0
  const mostRecentClick = clickHistoryForDisplay.reduce((latest, current) => 
    current.timestamp > latest.timestamp ? current : latest
  , clickHistoryForDisplay[0]);
  
  writeMCPLog(`[annotateScreenshot] Most recent click: (${mostRecentClick.x}, ${mostRecentClick.y}) at timestamp ${mostRecentClick.timestamp}`, 'Click Sorting');
  
  // Sort remaining clicks by weighted score (successCount * 2 + count), then by timestamp (descending) for same score
  // Exclude the most recent click from this sorting
  const remainingClicks = clickHistoryForDisplay.filter(click => click !== mostRecentClick);
  const sortedClicks = remainingClicks.sort((a, b) => {
    const scoreA = (a.successCount || 0) * 2 + a.count;
    const scoreB = (b.successCount || 0) * 2 + b.count;
    
    if (scoreB !== scoreA) {
      return scoreB - scoreA; // Higher weighted score first
    }
    return b.timestamp - a.timestamp; // Newer timestamp first (for same score)
  });
  
  writeMCPLog(`[annotateScreenshot] Sorted ${sortedClicks.length} remaining clicks by weighted score (successCount*2 + count) and recency`, 'Click Sorting');
  
  // Filter out overlapping clicks - keep only clicks that are far enough apart
  // Maximum 9 markers to avoid cluttering the screenshot (including the #0 marker)
  const MIN_DISTANCE_PIXELS = 200; // Minimum distance between annotations (in pixels)
  // const MAX_MARKERS = 10; // Maximum number of markers to display (including #0)
  const MAX_MARKERS = 5;
  const filteredClicks: ClickHistoryEntry[] = [];
  
  // Always add the most recent click as #0
  filteredClicks.push(mostRecentClick);
  
  // Filter remaining clicks
  for (const entry of sortedClicks) {
    // Stop if we've reached the maximum number of markers
    if (filteredClicks.length >= MAX_MARKERS) {
      writeMCPLog(`[annotateScreenshot] Reached maximum of ${MAX_MARKERS} markers, stopping`, 'Click Filtering');
      break;
    }
    
    // Convert logical coordinates to pixel coordinates
    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;
    
    // Check if this click is too close to any already-selected click
    let tooClose = false;
    for (const selected of filteredClicks) {
      const selectedPixelX = selected.x * scaleFactor;
      const selectedPixelY = selected.y * scaleFactor;
      
      const distance = Math.sqrt(
        Math.pow(pixelX - selectedPixelX, 2) + 
        Math.pow(pixelY - selectedPixelY, 2)
      );
      
      if (distance < MIN_DISTANCE_PIXELS) {
        tooClose = true;
        writeMCPLog(`[annotateScreenshot] Skipping click at (${entry.x}, ${entry.y}) - too close to (${selected.x}, ${selected.y}), distance: ${Math.round(distance)}px`, 'Click Filtering');
        break;
      }
    }
    
    if (!tooClose) {
      filteredClicks.push(entry);
    }
  }
  
  writeMCPLog(`[annotateScreenshot] Filtered clicks: ${clickHistoryForDisplay.length} -> ${filteredClicks.length} (removed overlapping, max ${MAX_MARKERS})`, 'Click Filtering');
  
  // Renumber the filtered clicks with consecutive indices starting from 0
  // The first click (most recent) gets #0, then #1, #2, #3...
  const uniqueClicks = filteredClicks.map((entry, index) => ({
    ...entry,
    displayIndex_original: entry.displayIndex, // Keep original display index
    displayNumber: index, // New consecutive number for display (0, 1, 2, 3...)
  }));
  
  writeMCPLog(`[annotateScreenshot] Renumbered ${uniqueClicks.length} clicks with consecutive indices 0-${uniqueClicks.length - 1} (most recent click is #0)`, 'Click Renumbering');
  
  // Build click history info text with normalized coordinates
  const historyLines = uniqueClicks.map(entry => {
    // Convert logical coordinates to pixel coordinates for the screenshot
    const pixelX = entry.x * scaleFactor;
    const pixelY = entry.y * scaleFactor;
    
    // Calculate normalized coordinates (0-1000)
    const normX = Math.round((pixelX / imageDims.width) * 1000);
    const normY = Math.round((pixelY / imageDims.height) * 1000);
    
    return `  #${entry.displayNumber}: [${normY}, ${normX}] (logical: ${entry.x}, ${entry.y}) - ${entry.operation}`;
  });
  const clickHistoryInfo = `Previous clicks on this display (normalized to 0-1000, sorted by frequency):\n${historyLines.join('\n')}`;
  
  // Create Python script to annotate image
  // Pass image dimensions and scale factor to Python
  const pythonScript = `
import sys
from PIL import Image, ImageDraw, ImageFont

try:
    # Load image
    img = Image.open('${screenshotPath.replace(/'/g, "\\'")}')
    img_width, img_height = img.size
    scale_factor = ${scaleFactor}
    
    # Create a semi-transparent overlay for drawing
    overlay = Image.new('RGBA', img.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Try to use a nice font, fallback to default
    # Platform-specific font paths
    import platform
    font = None
    small_font = None
    
    if platform.system() == 'Windows':
        # Windows fonts
        font_paths = [
            'C:/Windows/Fonts/arial.ttf',
            'C:/Windows/Fonts/segoeui.ttf',
            'C:/Windows/Fonts/tahoma.ttf',
        ]
    else:
        # macOS fonts
        font_paths = [
            '/System/Library/Fonts/Helvetica.ttc',
            '/System/Library/Fonts/SFNSDisplay.ttf',
            '/Library/Fonts/Arial.ttf',
        ]
    
    for font_path in font_paths:
        try:
            font = ImageFont.truetype(font_path, 32)
            small_font = ImageFont.truetype(font_path, 20)
            break
        except:
            continue
    
    if font is None:
        font = ImageFont.load_default()
        small_font = ImageFont.load_default()
    
    # Draw markers for each click
    clicks = ${JSON.stringify(uniqueClicks)}
    
    for click in clicks:
        # Logical coordinates from click history
        logical_x, logical_y = click['x'], click['y']
        display_number = click['displayNumber']  # Use the renumbered consecutive index
        
        # Convert logical coordinates to pixel coordinates for drawing
        pixel_x = int(logical_x * scale_factor)
        pixel_y = int(logical_y * scale_factor)
        
        # Calculate normalized coordinates (0-1000) for display
        norm_x = round((pixel_x / img_width) * 1000)
        norm_y = round((pixel_y / img_height) * 1000)
        
        # Draw circle with semi-transparent fill and bright outline
        radius = 20
        # Semi-transparent yellow fill
        draw.ellipse(
            [(pixel_x - radius, pixel_y - radius), (pixel_x + radius, pixel_y + radius)],
            fill=(255, 255, 0, 60),  # Yellow with 60/255 opacity
            outline=(255, 200, 0, 255),  # Bright orange outline, fully opaque
            width=3
        )
        
        # Draw crosshair (the exact click position) - bright and visible
        cross_size = 12
        draw.line(
            [(pixel_x - cross_size, pixel_y), (pixel_x + cross_size, pixel_y)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        draw.line(
            [(pixel_x, pixel_y - cross_size), (pixel_x, pixel_y + cross_size)], 
            fill=(255, 0, 0, 255),  # Bright red, fully opaque
            width=2
        )
        
        # Draw center dot for extra visibility
        dot_radius = 3
        draw.ellipse(
            [(pixel_x - dot_radius, pixel_y - dot_radius), (pixel_x + dot_radius, pixel_y + dot_radius)],
            fill=(255, 0, 0, 255)  # Bright red dot
        )
        
        # Draw number label with NORMALIZED coordinates (0-1000)
        label = f"#{display_number}"
        coord_label = f"[{norm_y},{norm_x}]"
        
        # Get text bounding boxes
        bbox_num = draw.textbbox((0, 0), label, font=font)
        bbox_coord = draw.textbbox((0, 0), coord_label, font=small_font)
        
        num_width = bbox_num[2] - bbox_num[0]
        num_height = bbox_num[3] - bbox_num[1]
        coord_width = bbox_coord[2] - bbox_coord[0]
        coord_height = bbox_coord[3] - bbox_coord[1]
        
        # Use the wider of the two labels for background width
        max_width = max(num_width, coord_width)
        total_height = num_height + coord_height + 4  # 4px spacing between lines
        
        # Position label above and to the right of the marker
        label_x = pixel_x + radius + 8
        label_y = pixel_y - radius - total_height - 8
        
        # Ensure label stays within image bounds
        if label_x + max_width + 10 > img_width:
            label_x = pixel_x - radius - max_width - 18
        if label_y < 0:
            label_y = pixel_y + radius + 8
        
        # Draw semi-transparent background rectangle with border
        padding = 4
        # Background with transparency
        draw.rectangle(
            [
                (label_x - padding, label_y - padding),
                (label_x + max_width + padding, label_y + total_height + padding)
            ],
            fill=(0, 0, 0, 180),  # Black with 180/255 opacity
            outline=(255, 200, 0, 255),  # Orange border
            width=2
        )
        
        # Draw number text in bright yellow
        draw.text((label_x, label_y), label, fill=(255, 255, 0, 255), font=font)
        
        # Draw normalized coordinate text below the number in white
        coord_y = label_y + num_height + 2
        draw.text((label_x, coord_y), coord_label, fill=(255, 255, 255, 255), font=small_font)
    
    # Convert back to RGB and composite with original image
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
    img = Image.alpha_composite(img, overlay)
    img = img.convert('RGB')
    
    # Save annotated image
    img.save('${annotatedPath.replace(/'/g, "\\'")}')
    print('SUCCESS')
    
except Exception as e:
    print(f'ERROR: {str(e)}', file=sys.stderr)
    sys.exit(1)
`.trim();
  
  try {
    const result = await executePython(pythonScript, 20000);
    
    if (result.stdout.includes('SUCCESS')) {
      writeMCPLog(`[annotateScreenshot] Successfully annotated screenshot with ${clickHistoryForDisplay.length} click markers`, 'Screenshot Annotation');
      writeMCPLog(`[annotateScreenshot] Annotated image saved to: ${annotatedPath}`, 'Screenshot Annotation');
      return { annotatedPath, clickHistoryInfo };
    } else {
      writeMCPLog(`[annotateScreenshot] Python script did not return SUCCESS: ${result.stdout}`, 'Screenshot Annotation Error');
      throw new Error('Failed to annotate screenshot');
    }
  } catch (error: any) {
    writeMCPLog(`[annotateScreenshot] Error annotating screenshot: ${error.message}`, 'Screenshot Annotation Error');
    // Fallback: return original path if annotation fails
    return {
      annotatedPath: screenshotPath,
      clickHistoryInfo,
    };
  }
}

/**
 * Analyze screenshot with vision model to locate element
 */
async function analyzeScreenshotWithVision(
  screenshotPath: string,
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
}> {
  try {
    // Get display configuration for coordinate system info
    const config = await getDisplayConfiguration();
    const targetDisplay = displayIndex !== undefined 
      ? config.displays.find(d => d.index === displayIndex)
      : config.displays.find(d => d.isMain);
    
    if (!targetDisplay) {
      throw new Error(`Display index ${displayIndex} not found`);
    }
    
    // Annotate screenshot with click history
    const { annotatedPath, clickHistoryInfo } = await annotateScreenshotWithClickHistory(
      screenshotPath,
      targetDisplay.index
    );

    // const annotatedPath = screenshotPath;

    writeMCPLog(`[analyzeScreenshotWithVision] Using screenshot: ${annotatedPath}`, 'Screenshot Selection');
    writeMCPLog(`[analyzeScreenshotWithVision] Click history: ${clickHistoryInfo}`, 'Click History');
    
    // Read annotated screenshot as base64
    const imageBuffer = await fs.readFile(annotatedPath);
    const base64Image = imageBuffer.toString('base64');
    
    // Get image dimensions
    const imageDims = await getImageDimensions(annotatedPath);
    
    const prompt = `给我${elementDescription}的grounding坐标。

**注意**：图片上可能有黄色圆圈标记，这些是之前点击过的位置（仅用于相对位置参考，它们并不一定是正确的点击位置），标记格式为"#序号"和已经归一化之后的"[y,x]"坐标。这些标记不是界面的一部分，请忽略它们，只定位实际的界面元素。

坐标格式：归一化到0-1000，格式为[ymin, xmin, ymax, xmax]

返回JSON（不要markdown）:
{"box_2d": [ymin, xmin, ymax, xmax], "confidence": <0-100>}`;

    writeMCPLog(`[analyzeScreenshotWithVision] Prompt: ${prompt}`);
    
    const responseText = await callVisionAPI(base64Image, prompt, 20000, 'analyzeScreenshotWithVision');
    writeMCPLog(`[analyzeScreenshotWithVision] Raw Response Length: ${responseText.length}`, 'Response');
    writeMCPLog(`[analyzeScreenshotWithVision] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`, 'Response Preview');
    
    // Parse the response
    let jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      writeMCPLog(`[analyzeScreenshotWithVision] No JSON found with simple regex, trying code block pattern`, 'Parse Attempt');
      const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonMatch = [codeBlockMatch[1]];
        writeMCPLog(`[analyzeScreenshotWithVision] Found JSON in code block, length: ${jsonMatch[0].length}`, 'Parse Success');
      }
    } else {
      writeMCPLog(`[analyzeScreenshotWithVision] Found JSON with simple regex, length: ${jsonMatch[0].length}`, 'Parse Success');
    }
    
    if (!jsonMatch) {
      writeMCPLog(`[analyzeScreenshotWithVision] Failed to find JSON in response. Full response: ${responseText}`, 'Parse Error');
      throw new Error('Failed to parse vision model response: No JSON found in response');
    }
    
    let result;
    try {
      writeMCPLog(`[analyzeScreenshotWithVision] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`, 'JSON Parse');
      result = JSON.parse(jsonMatch[0]);
      writeMCPLog(`[analyzeScreenshotWithVision] JSON parsed successfully`, 'JSON Parse Success');
    } catch (parseError: any) {
      writeMCPLog(`[analyzeScreenshotWithVision] JSON parse failed: ${parseError.message}`, 'JSON Parse Error');
      writeMCPLog(`[analyzeScreenshotWithVision] JSON string that failed to parse: ${jsonMatch[0]}`, 'JSON Parse Error');
      throw new Error(`Failed to parse JSON: ${parseError.message}. JSON string: ${jsonMatch[0].substring(0, 500)}`);
    }

    // Validate that box_2d exists and is an array
    if (!result.box_2d || !Array.isArray(result.box_2d) || result.box_2d.length !== 4) {
      writeMCPLog(`[analyzeScreenshotWithVision] Invalid box_2d in response: ${JSON.stringify(result)}`, 'Parse Error');
      throw new Error('Vision response missing or invalid box_2d field. Expected format: [ymin, xmin, ymax, xmax]');
    }

    // Extract normalized coordinates (0-1000 range)
    // Format: [ymin, xmin, ymax, xmax]
    const [ymin_norm, xmin_norm, ymax_norm, xmax_norm] = result.box_2d;

    writeMCPLog(`[analyzeScreenshotWithVision] Normalized box (0-1000): [ymin=${ymin_norm}, xmin=${xmin_norm}, ymax=${ymax_norm}, xmax=${xmax_norm}]`, 'Normalized Coordinates');

    // Convert normalized coordinates (0-1000) to pixel coordinates
    // Image dimensions: imageDims.width x imageDims.height
    const xmin_pixel = Math.round((xmin_norm / 1000) * imageDims.width);
    const ymin_pixel = Math.round((ymin_norm / 1000) * imageDims.height);
    const xmax_pixel = Math.round((xmax_norm / 1000) * imageDims.width);
    const ymax_pixel = Math.round((ymax_norm / 1000) * imageDims.height);

    writeMCPLog(`[analyzeScreenshotWithVision] Pixel coordinates: xmin=${xmin_pixel}, ymin=${ymin_pixel}, xmax=${xmax_pixel}, ymax=${ymax_pixel}`, 'Pixel Coordinates');
    writeMCPLog(`[analyzeScreenshotWithVision] Image dimensions: ${imageDims.width}x${imageDims.height}`, 'Image Info');

    // Calculate center point from bounding box (in pixel space)
    const pixelCenterX = Math.round((xmin_pixel + xmax_pixel) / 2);
    const pixelCenterY = Math.round((ymin_pixel + ymax_pixel) / 2);

    writeMCPLog(`[analyzeScreenshotWithVision] Calculated center from bounding box (pixels): x=${pixelCenterX}, y=${pixelCenterY}`, 'Center Calculation');

    // Convert from pixel coordinates to logical coordinates
    // On Retina displays (scaleFactor=2), screenshots are 2x the logical resolution
    // Vision returns pixel coordinates, but cliclick uses logical coordinates
    const scaleFactor = targetDisplay.scaleFactor || 1;
    writeMCPLog(`[analyzeScreenshotWithVision] Display scaleFactor: ${scaleFactor}`, 'Coordinate Conversion');

    const logicalX = pixelCenterX / scaleFactor;
    const logicalY = pixelCenterY / scaleFactor;

    writeMCPLog(`[analyzeScreenshotWithVision] Logical coordinates for cliclick: x=${logicalX}, y=${logicalY}`, 'Coordinate Conversion');

    return {
      x: Math.round(logicalX),
      y: Math.round(logicalY),
      confidence: result.confidence || 0,
      displayIndex: targetDisplay.index,
      boundingBox: {
        left: xmin_pixel,
        top: ymin_pixel,
        right: xmax_pixel,
        bottom: ymax_pixel
      }
    };
  } catch (error: any) {
    throw new Error(`Vision analysis failed: ${error.message}`);
  }
}

/**
 * Mark a point on an image with a visual indicator
 * Creates a copy of the image with a red circle and crosshair at the specified coordinates
 * Optionally draws a bounding box if provided
 * Uses Python PIL/Pillow for cross-platform compatibility
 */
async function markPointOnImage(
  imagePath: string,
  x: number,
  y: number,
  outputPath?: string,
  boundingBox?: { left: number; top: number; right: number; bottom: number }
): Promise<string> {
  const markedPath = outputPath || imagePath.replace(/\.png$/, '_marked.png');

  try {
    // Build bounding box parameters for Python script
    const bboxParams = boundingBox
      ? `bbox = {"left": ${boundingBox.left}, "top": ${boundingBox.top}, "right": ${boundingBox.right}, "bottom": ${boundingBox.bottom}}`
      : `bbox = None`;

    const pythonScript = `
try:
    from PIL import Image, ImageDraw

    # Load image
    img = Image.open("${imagePath.replace(/\\/g, '\\\\')}")
    draw = ImageDraw.Draw(img)

    # Bounding box (if provided)
    ${bboxParams}

    # Draw bounding box if provided
    if bbox:
        draw.rectangle([bbox["left"], bbox["top"], bbox["right"], bbox["bottom"]], outline='green', width=2)

    # Draw center point markers
    x, y = ${x}, ${y}
    radius = 20
    draw.ellipse([x - radius, y - radius, x + radius, y + radius], outline='red', width=3)

    # Draw crosshair
    draw.line([x - 30, y, x + 30, y], fill='red', width=2)
    draw.line([x, y - 30, x, y + 30], fill='red', width=2)

    # Draw center point
    draw.ellipse([x - 2, y - 2, x + 2, y + 2], fill='red')

    # Save marked image
    img.save("${markedPath.replace(/\\/g, '\\\\')}")
    print(f"Success: Marked image saved to ${markedPath.replace(/\\/g, '\\\\')}")
except ImportError:
    print("Error: PIL/Pillow not installed. Install with: pip install Pillow")
    exit(1)
except Exception as e:
    print(f"Error: {e}")
    exit(1)
    `.trim();

    const result = await executePython(pythonScript, 5000);

    if (result.stdout.includes('Success')) {
      const markInfo = boundingBox
        ? `point (${x}, ${y}) with bounding box [${boundingBox.left}, ${boundingBox.top}, ${boundingBox.right}, ${boundingBox.bottom}]`
        : `point (${x}, ${y})`;
      writeMCPLog(`[markPointOnImage] Marked ${markInfo} on image, saved to: ${markedPath}`, 'Image Marking');
      return markedPath;
    } else {
      throw new Error(result.stdout || result.stderr || 'Unknown error');
    }
  } catch (error: any) {
    writeMCPLog(`[markPointOnImage] Could not mark image: ${error.message}`, 'Image Marking Warning');
    writeMCPLog(`[markPointOnImage] To enable image marking, install Pillow: pip3 install Pillow`, 'Image Marking Warning');
    return imagePath; // Return original path if marking fails
  }
}

/**
 * Get image dimensions
 */
async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  try {
    // Use sips on macOS to get image dimensions
    const platform = os.platform();
    
    if (platform === 'darwin') {
      // Use absolute path because packaged apps may have a limited PATH.
      const { stdout } = await executeCommand(`/usr/bin/sips -g pixelWidth -g pixelHeight "${imagePath}"`);
      const widthMatch = stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = stdout.match(/pixelHeight:\s*(\d+)/);
      
      if (widthMatch && heightMatch) {
        return {
          width: parseInt(widthMatch[1]),
          height: parseInt(heightMatch[1]),
        };
      }
    }
    
    // Fallback: read PNG dimensions from file header
    const buffer = await fs.readFile(imagePath);
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      // PNG file
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    
    throw new Error('Could not determine image dimensions');
  } catch (error: any) {
    // Fallback: use display dimensions
    const config = await getDisplayConfiguration();
    const mainDisplay = config.displays.find(d => d.isMain) || config.displays[0];
    return { width: mainDisplay.width, height: mainDisplay.height };
  }
}

/**
 * Plan GUI actions based on natural language task description
 * Returns a step-by-step plan for executing the task
 */
async function planGUIActions(
  taskDescription: string,
  displayIndex?: number
): Promise<{ steps: Array<{ step: number; action: string; element_description: string; value?: string; reasoning: string }>; summary?: string }> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI action planning is not supported on platform: ${PLATFORM}`);
  }
  
  // Take screenshot to understand current GUI state
  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_plan_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);
  
  // Get image dimensions
  const imageDims = await getImageDimensions(screenshotPath);
  
  // Read screenshot as base64
  const imageBuffer = await fs.readFile(screenshotPath);
  const base64Image = imageBuffer.toString('base64');
  
  const prompt = `Analyze this GUI screenshot and create a step-by-step plan to accomplish the following task: "${taskDescription}"

**COORDINATE SYSTEM:**
- Image dimensions: ${imageDims.width}x${imageDims.height} pixels
- Origin (0,0) is at TOP-LEFT corner

**TASK:**
Break down the task "${taskDescription}" into a sequence of GUI operations.

**INSTRUCTIONS:**
1. Analyze the current GUI state shown in the screenshot
2. Identify what elements need to be interacted with
3. Create a step-by-step plan with specific actions
4. For each step, describe the element to interact with and what action to perform
5. Include any text values that need to be entered

**AVAILABLE ACTIONS:**
- click: Single click on an element
- double_click: Double click on an element
- right_click: Right click on an element
- type: Type text into an input field (requires value parameter)
- hover: Move mouse over an element
- key_press: Press a key (requires value parameter with key name)

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "steps": [
    {
      "step": 1,
      "action": "click|double_click|right_click|type|hover|key_press",
      "element_description": "<detailed description of the element to interact with>",
      "value": "<optional: text to type or key to press>",
      "reasoning": "<explanation of why this step is needed>"
    }
  ],
  "summary": "<brief summary of the plan>"
}

Be specific and detailed in element descriptions. For example:
- Instead of "button", use "the red Start button in the top-right corner"
- Instead of "input", use "the text input field labeled 'File Name'"
- Instead of "menu", use "the File menu in the menu bar"`;

  const responseText = await callVisionAPI(base64Image, prompt, 20000, 'planGUIActions');
  writeMCPLog(`[planGUIActions] Raw Response Length: ${responseText.length}`, 'Response');
  writeMCPLog(`[planGUIActions] Raw Response (first 500 chars): ${responseText.substring(0, 500)}`, 'Response Preview');
  
  // Parse the response
  let jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    writeMCPLog(`[planGUIActions] No JSON found with simple regex, trying code block pattern`, 'Parse Attempt');
    const codeBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonMatch = [codeBlockMatch[1]];
      writeMCPLog(`[planGUIActions] Found JSON in code block, length: ${jsonMatch[0].length}`, 'Parse Success');
    }
  } else {
    writeMCPLog(`[planGUIActions] Found JSON with simple regex, length: ${jsonMatch[0].length}`, 'Parse Success');
  }
  
  if (!jsonMatch) {
    writeMCPLog(`[planGUIActions] Failed to find JSON in response. Full response: ${responseText}`, 'Parse Error');
    throw new Error('Failed to parse action plan response: No JSON found in response');
  }
  
  let plan;
  try {
    writeMCPLog(`[planGUIActions] Attempting to parse JSON (first 200 chars): ${jsonMatch[0].substring(0, 200)}`, 'JSON Parse');
    plan = JSON.parse(jsonMatch[0]);
    writeMCPLog(`[planGUIActions] JSON parsed successfully. Steps count: ${plan.steps?.length || 0}`, 'JSON Parse Success');
  } catch (parseError: any) {
    writeMCPLog(`[planGUIActions] JSON parse failed: ${parseError.message}`, 'JSON Parse Error');
    writeMCPLog(`[planGUIActions] JSON string that failed to parse: ${jsonMatch[0]}`, 'JSON Parse Error');
    throw new Error(`Failed to parse action plan JSON: ${parseError.message}. JSON string: ${jsonMatch[0].substring(0, 500)}`);
  }
  
  if (!plan.steps || !Array.isArray(plan.steps)) {
    writeMCPLog(`[planGUIActions] Invalid plan format. Plan keys: ${Object.keys(plan).join(', ')}, steps type: ${typeof plan.steps}`, 'Validation Error');
    throw new Error(`Invalid action plan format: missing steps array. Plan structure: ${JSON.stringify(plan, null, 2).substring(0, 500)}`);
  }
  
  return plan;
}

/**
 * Locate a GUI element using vision
 */
async function locateGUIElement(
  elementDescription: string,
  displayIndex?: number
): Promise<{
  x: number;
  y: number;
  confidence: number;
  displayIndex: number;
  reasoning?: string;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
}> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Element location is not supported on platform: ${PLATFORM}`);
  }

  // On macOS, prefer deterministic Dock lookup for Dock-related requests.
  // This avoids visual mis-grounding when multiple similar icons are present.
  if (PLATFORM === 'darwin') {
    try {
      const dockCoords = await tryLocateElementInDockByAccessibility(elementDescription, displayIndex);
      if (dockCoords) {
        return dockCoords;
      }
    } catch (dockError: any) {
      writeMCPLog(`[locateGUIElement] Dock accessibility lookup failed: ${dockError.message}`, 'Dock Locate Warning');
    }
  }
  
  // Take screenshot
  const screenshotPath = path.join(SCREENSHOTS_DIR, `gui_locate_${Date.now()}.png`);
  await takeScreenshot(screenshotPath, displayIndex);

  // Analyze screenshot to find element
  const coords = await analyzeScreenshotWithVision(screenshotPath, elementDescription, displayIndex);

  // Mark the located point on the screenshot
  // Note: coords are in logical coordinates, but the screenshot is in pixel coordinates
  // So we need to convert back to pixel coordinates for marking
  try {
    const config = await getDisplayConfiguration();
    const targetDisplay = displayIndex !== undefined
      ? config.displays.find(d => d.index === displayIndex)
      : config.displays.find(d => d.isMain);

    if (targetDisplay) {
      const scaleFactor = targetDisplay.scaleFactor || 1;
      const pixelX = coords.x * scaleFactor;
      const pixelY = coords.y * scaleFactor;

      writeMCPLog(`[locateGUIElement] Marking point on screenshot: logical=(${coords.x}, ${coords.y}), pixel=(${pixelX}, ${pixelY})`, 'Image Marking');

      // coords.boundingBox is already in pixel coordinates
      const markedPath = await markPointOnImage(screenshotPath, pixelX, pixelY, undefined, coords.boundingBox);
      writeMCPLog(`[locateGUIElement] Marked screenshot saved to: ${markedPath}`, 'Image Marking');
    }
  } catch (markError: any) {
    // Don't fail if marking fails, just log the error
    writeMCPLog(`[locateGUIElement] Failed to mark screenshot: ${markError.message}`, 'Image Marking Warning');
  }

  return coords;
}

/**
 * Execute a single GUI action step
 */
async function executeActionStep(
  step: { step: number; action: string; element_description: string; value?: string },
  displayIndex?: number
): Promise<{ success: boolean; step: number; action: string; coordinates?: { x: number; y: number }; error?: string }> {
  try {
    writeMCPLog(`[executeActionStep] Starting step ${step.step}: ${step.action} on "${step.element_description}"`, 'Step Execution');
    
    // Locate the element
    const coords = await locateGUIElement(step.element_description, displayIndex);
    writeMCPLog(`[executeActionStep] Step ${step.step}: Located element at (${coords.x}, ${coords.y}) with confidence ${coords.confidence}%`, 'Step Execution');
    
    if (coords.confidence < 50) {
      writeMCPLog(`[executeActionStep] Step ${step.step}: Low confidence (${coords.confidence}%), aborting`, 'Step Execution');
      return {
        success: false,
        step: step.step,
        action: step.action,
        error: `Element "${step.element_description}" not found with sufficient confidence (${coords.confidence}%)`,
      };
    }
    
    // Perform the action
    writeMCPLog(`[executeActionStep] Step ${step.step}: Executing action "${step.action}"`, 'Step Execution');
    switch (step.action) {
      case 'click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        writeMCPLog(`[executeActionStep] Step ${step.step}: Click completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'click',
          coordinates: { x: coords.x, y: coords.y },
        };
        
      case 'double_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'double');
        writeMCPLog(`[executeActionStep] Step ${step.step}: Double click completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'double_click',
          coordinates: { x: coords.x, y: coords.y },
        };
        
      case 'right_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'right');
        writeMCPLog(`[executeActionStep] Step ${step.step}: Right click completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'right_click',
          coordinates: { x: coords.x, y: coords.y },
        };
        
      case 'type':
        if (!step.value) {
          writeMCPLog(`[executeActionStep] Step ${step.step}: Type action missing value`, 'Step Execution Error');
          return {
            success: false,
            step: step.step,
            action: 'type',
            error: 'Value is required for type action',
          };
        }
        // Click first to focus, then type
        writeMCPLog(`[executeActionStep] Step ${step.step}: Clicking to focus, then typing "${step.value}"`, 'Step Execution');
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        await new Promise(resolve => setTimeout(resolve, 200));
        await performType(step.value, false);
        writeMCPLog(`[executeActionStep] Step ${step.step}: Type completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'type',
          coordinates: { x: coords.x, y: coords.y },
        };
        
      case 'hover':
        await moveMouse(coords.x, coords.y, coords.displayIndex);
        writeMCPLog(`[executeActionStep] Step ${step.step}: Hover completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'hover',
          coordinates: { x: coords.x, y: coords.y },
        };
        
      case 'key_press':
        if (!step.value) {
          writeMCPLog(`[executeActionStep] Step ${step.step}: Key press action missing key name`, 'Step Execution Error');
          return {
            success: false,
            step: step.step,
            action: 'key_press',
            error: 'Key name is required for key_press action',
          };
        }
        writeMCPLog(`[executeActionStep] Step ${step.step}: Pressing key "${step.value}"`, 'Step Execution');
        await performKeyPress(step.value, []);
        writeMCPLog(`[executeActionStep] Step ${step.step}: Key press completed successfully`, 'Step Execution');
        return {
          success: true,
          step: step.step,
          action: 'key_press',
        };
        
      default:
        writeMCPLog(`[executeActionStep] Step ${step.step}: Unsupported action "${step.action}"`, 'Step Execution Error');
        return {
          success: false,
          step: step.step,
          action: step.action,
          error: `Unsupported action: ${step.action}`,
        };
    }
  } catch (error: any) {
    writeMCPLog(`[executeActionStep] Step ${step.step}: Error occurred: ${error.message}`, 'Step Execution Error');
    writeMCPLog(`[executeActionStep] Step ${step.step}: Error stack: ${error.stack}`, 'Step Execution Error');
    return {
      success: false,
      step: step.step,
      action: step.action,
      error: error.message,
    };
  }
}

/**
 * Perform GUI interaction using vision - automatically plans and executes steps
 */
async function performVisionBasedInteraction(
  taskDescription: string,
  displayIndex?: number
): Promise<string> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`Vision-based GUI interaction is not supported on platform: ${PLATFORM}`);
  }
  
  writeMCPLog(`[performVisionBasedInteraction] Starting task: "${taskDescription}"`, 'Task Start');
  writeMCPLog(`[performVisionBasedInteraction] Display index: ${displayIndex ?? 'main'}`, 'Task Start');
  
  // Step 1: Plan the actions
  writeMCPLog(`[performVisionBasedInteraction] Step 1: Planning actions...`, 'Task Planning');
  let plan;
  try {
    plan = await planGUIActions(taskDescription, displayIndex);
    writeMCPLog(`[performVisionBasedInteraction] Planning completed. Total steps: ${plan.steps.length}`, 'Task Planning');
    writeMCPLog(`[performVisionBasedInteraction] Plan summary: ${plan.summary || 'No summary'}`, 'Task Planning');
  } catch (error: any) {
    writeMCPLog(`[performVisionBasedInteraction] Planning failed: ${error.message}`, 'Task Planning Error');
    throw error;
  }
  
  // Step 2: Execute each step
  writeMCPLog(`[performVisionBasedInteraction] Step 2: Executing ${plan.steps.length} steps...`, 'Task Execution');
  const results: Array<{ step: number; success: boolean; action: string; element_description: string; error?: string; coordinates?: { x: number; y: number } }> = [];
  
  for (const step of plan.steps) {
    writeMCPLog(`[performVisionBasedInteraction] Executing step ${step.step}/${plan.steps.length}: ${step.action}`, 'Task Execution');
    // Wait a bit between steps to allow GUI to update
    // Longer wait after type actions to allow UI to process
    if (results.length > 0) {
      const lastAction = results[results.length - 1]?.action;
      const waitTime = lastAction === 'type' ? 800 : 500;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    const result = await executeActionStep(step, displayIndex);
    results.push({
      step: step.step,
      success: result.success,
      action: step.action,
      element_description: step.element_description,
      error: result.error,
      coordinates: result.coordinates,
    });
    
    // If a step fails, stop execution
    if (!result.success) {
      writeMCPLog(`[performVisionBasedInteraction] Step ${step.step} failed, stopping execution`, 'Task Execution Error');
      break;
    } else {
      writeMCPLog(`[performVisionBasedInteraction] Step ${step.step} completed successfully`, 'Task Execution');
    }
    
    // Additional wait after click actions that might open dialogs/menus
    if (step.action === 'click' || step.action === 'double_click') {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  const allSuccessful = results.every(r => r.success);
  writeMCPLog(`[performVisionBasedInteraction] Task completed. Success: ${allSuccessful}, Steps executed: ${results.length}/${plan.steps.length}`, 'Task Completion');
  
  return JSON.stringify({
    success: allSuccessful,
    task: taskDescription,
    plan_summary: plan.summary || 'No summary provided',
    steps_executed: results.length,
    total_steps: plan.steps.length,
    results,
    failed_at_step: allSuccessful ? undefined : results.findIndex(r => !r.success) + 1,
  });
}

/**
 * Verify GUI state using vision
 */
async function verifyGUIState(
  question: string,
  displayIndex?: number
): Promise<string> {
  // Supported on both macOS and Windows
  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    throw new Error(`GUI verification is not supported on platform: ${PLATFORM}`);
  }
  
  const normalizedDisplayIndex = displayIndex ?? 0;
  const regionKey = toRegionKey(undefined);
  const reusable = getReusableScreenshot(normalizedDisplayIndex, regionKey);

  let screenshotPath: string;
  let base64Image: string;

  if (reusable) {
    screenshotPath = reusable.path;
    base64Image = reusable.base64Image;
    writeMCPLog(
      `[verifyGUIState] Reusing recent screenshot captured ${Date.now() - reusable.capturedAt}ms ago: ${reusable.path}`,
      'Screenshot Reuse'
    );
  } else {
    screenshotPath = path.join(SCREENSHOTS_DIR, `gui_verify_${Date.now()}.png`);
    await takeScreenshot(screenshotPath, displayIndex);
    const imageBuffer = await fs.readFile(screenshotPath);
    base64Image = imageBuffer.toString('base64');

    const config = await getDisplayConfiguration();
    const display = config.displays.find(d => d.index === normalizedDisplayIndex) || config.displays[0];
    updateScreenshotCache({
      displayIndex: normalizedDisplayIndex,
      regionKey,
      path: screenshotPath,
      base64Image,
      capturedAt: Date.now(),
      displayInfo: {
        width: display.width,
        height: display.height,
        scaleFactor: display.scaleFactor,
      },
    });
  }
  
  const prompt = `Analyze this GUI screenshot and answer the following question:

${question}

Provide a detailed answer based on what you can see in the image.

IMPORTANT: At the end of your response, you MUST provide a formatted judgment on whether the most recent GUI operation was accurate/successful. Use this exact format:

**Operation Success Judgment:**
- Status: [SUCCESS/FAILURE]
- Reason: [Brief explanation of why the operation succeeded or failed]

Example:
**Operation Success Judgment:**
- Status: SUCCESS
- Reason: The button was clicked correctly in the expected dialog window.`;

  let answer = await callVisionAPI(base64Image, prompt, 20000, 'verifyGUIState');
  writeMCPLog(`[verifyGUIState] Response Length: ${answer.length}`, 'Response');
  writeMCPLog(`[verifyGUIState] Response (first 500 chars): ${answer.substring(0, 500)}`, 'Response Preview');
  
  // Parse the operation success judgment
  let operationSuccess = false;
  const successMatch = answer.match(/\*\*Operation Success Judgment:\*\*[\s\S]*?Status:\s*(SUCCESS|FAILURE)/i);
  if (successMatch) {
    operationSuccess = successMatch[1].toUpperCase() === 'SUCCESS';
    writeMCPLog(`[verifyGUIState] Parsed operation success: ${operationSuccess}`, 'Success Parsing');
    
    // If operation was successful and we have a recent click, increment its successCount
    if (operationSuccess && lastClickEntry) {
      lastClickEntry.successCount = (lastClickEntry.successCount || 0) + 1;
      writeMCPLog(`[verifyGUIState] Incremented successCount for click at (${lastClickEntry.x}, ${lastClickEntry.y}) to ${lastClickEntry.successCount}`, 'Success Tracking');
      
      // Save the updated click history to disk
      await saveLatestClickToHistory(lastClickEntry, { incrementCount: false });
    }
  } else {
    writeMCPLog(`[verifyGUIState] Could not parse operation success judgment from response`, 'Success Parsing Warning');
  }

  // Cross-check with macOS frontmost app for app-open verification style questions.
  // This prevents false-positive "SUCCESS" when the wrong app is actually focused.
  if (PLATFORM === 'darwin') {
    const expectedAliases = inferExpectedAppAliasesFromText(question);
    const requiresForegroundMatch = isLikelyAppLaunchVerification(question);

    if (expectedAliases.length > 0 && requiresForegroundMatch) {
      const frontmostApp = await getFrontmostMacApplicationName();
      if (frontmostApp) {
        const frontmostMatched = appNameMatchesAliases(frontmostApp, expectedAliases);
        writeMCPLog(
          `[verifyGUIState] Frontmost app cross-check. frontmost="${frontmostApp}", expectedAliases=${JSON.stringify(expectedAliases)}, matched=${frontmostMatched}`,
          'Success Parsing'
        );

        if (operationSuccess && !frontmostMatched) {
          operationSuccess = false;
          answer += `\n\n[System Cross-check] Frontmost app is "${frontmostApp}", which does not match the expected target app from the question.`;
          writeMCPLog(
            `[verifyGUIState] Overrode operationSuccess to false due to frontmost app mismatch.`,
            'Success Parsing Warning'
          );
        }
      }
    }
  }
  
  return JSON.stringify({
    success: true,
    question,
    answer,
    operationSuccess,
    screenshot_path: screenshotPath,
    displayIndex: normalizedDisplayIndex,
  });
}

function toRegionKey(region?: { x: number; y: number; width: number; height: number }): string {
  if (!region) {
    return 'full';
  }
  return `${region.x},${region.y},${region.width},${region.height}`;
}

function getReusableScreenshot(displayIndex: number, regionKey: string): ScreenshotCacheEntry | null {
  if (!lastScreenshotCache) {
    return null;
  }
  if (lastScreenshotCache.displayIndex !== displayIndex) {
    return null;
  }
  if (lastScreenshotCache.regionKey !== regionKey) {
    return null;
  }
  const age = Date.now() - lastScreenshotCache.capturedAt;
  if (age > SCREENSHOT_REUSE_WINDOW_MS) {
    return null;
  }
  return lastScreenshotCache;
}

function updateScreenshotCache(entry: ScreenshotCacheEntry): void {
  lastScreenshotCache = entry;
}

function extractTextFromResponsesSSE(sseText: string): string {
  const channelText = new Map<string, string>();
  const channelOrder: string[] = [];
  let completedSnapshot = '';
  const blocks = sseText.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    let eventType = '';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      continue;
    }

    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      const parsed = JSON.parse(payload);
      const parsedType = typeof parsed?.type === 'string' ? parsed.type : '';
      const effectiveType = eventType || parsedType;

      // Prefer true streaming deltas. Some backends send cumulative delta snapshots,
      // so we merge per-channel instead of naive append.
      const delta = extractResponsesDeltaText(parsed);
      if (delta && (effectiveType.includes('output_text.delta') || effectiveType === '' || parsedType === 'response.output_text.delta')) {
        const channel = deriveResponsesDeltaChannelKey(parsed);
        if (!channelOrder.includes(channel)) {
          channelOrder.push(channel);
        }
        const merged = mergeResponsesDelta(channelText.get(channel) || '', delta);
        channelText.set(channel, merged);
      }

      if (
        effectiveType.includes('response.completed') ||
        parsedType === 'response.completed'
      ) {
        const snapshot = extractOutputTextFromResponsesPayload(parsed?.response || parsed);
        if (snapshot) {
          completedSnapshot = snapshot;
        }
      }
    } catch {
      // Ignore non-JSON SSE chunks
    }
  }

  const streamed = chooseBestStreamedText(channelText, channelOrder);
  if (streamed.trim()) {
    return cleanupRepeatedVisionOutput(streamed);
  }
  if (completedSnapshot.trim()) {
    return cleanupRepeatedVisionOutput(completedSnapshot);
  }
  return '';
}

function extractOutputTextFromResponsesPayload(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }
  if (typeof payload.delta === 'string') {
    return payload.delta;
  }
  if (typeof payload.text === 'string') {
    return payload.text;
  }
  if (payload.response) {
    const nested = extractOutputTextFromResponsesPayload(payload.response);
    if (nested) {
      return nested;
    }
  }
  if (Array.isArray(payload.output)) {
    const parts: string[] = [];
    for (const item of payload.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block?.type === 'output_text' && typeof block.text === 'string') {
            parts.push(block.text);
          }
        }
      }
    }
    if (parts.length > 0) {
      return parts.join('\n');
    }
  }
  return '';
}

function extractResponsesDeltaText(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (typeof payload.delta === 'string') {
    return payload.delta;
  }
  if (payload.item && typeof payload.item === 'object' && typeof payload.item.delta === 'string') {
    return payload.item.delta;
  }
  return '';
}

function deriveResponsesDeltaChannelKey(payload: any): string {
  if (!payload || typeof payload !== 'object') {
    return 'default';
  }
  const p = payload as Record<string, unknown>;
  const outputIndex = typeof p.output_index === 'number' ? p.output_index : null;
  const contentIndex = typeof p.content_index === 'number' ? p.content_index : null;
  const itemId = typeof p.item_id === 'string' ? p.item_id : '';
  if (itemId) {
    return `item:${itemId}`;
  }
  if (outputIndex !== null || contentIndex !== null) {
    return `idx:${outputIndex ?? -1}:${contentIndex ?? -1}`;
  }
  return 'default';
}

function mergeResponsesDelta(existing: string, delta: string): string {
  if (!existing) {
    return delta;
  }

  // Cumulative snapshot mode: new delta includes previous text.
  if (delta.startsWith(existing)) {
    return delta;
  }

  // Exact repeat or stale chunk.
  if (existing.endsWith(delta) || existing === delta || existing.startsWith(delta)) {
    return existing;
  }

  // Incremental mode with overlap.
  const overlap = findSuffixPrefixOverlap(existing, delta);
  if (overlap > 0) {
    return existing + delta.slice(overlap);
  }

  return existing + delta;
}

function findSuffixPrefixOverlap(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let size = max; size > 0; size--) {
    if (left.slice(-size) === right.slice(0, size)) {
      return size;
    }
  }
  return 0;
}

function chooseBestStreamedText(channelText: Map<string, string>, order: string[]): string {
  const collected = order
    .map((key) => (channelText.get(key) || '').trim())
    .filter((text) => text.length > 0);
  if (collected.length === 0) {
    return '';
  }
  if (collected.length === 1) {
    return collected[0];
  }

  // Prefer the longest channel text; most duplicated channels are equivalent snapshots.
  const sorted = [...new Set(collected)].sort((a, b) => b.length - a.length);
  const longest = sorted[0];
  const othersAllContained = sorted.slice(1).every((item) => longest.includes(item));
  if (othersAllContained) {
    return longest;
  }

  return sorted.join('\n');
}

function cleanupRepeatedVisionOutput(text: string): string {
  const normalized = collapseLikelyEchoDoubles(text.replace(/\r\n/g, '\n').trim());
  if (!normalized) {
    return normalized;
  }

  const fullDup = findLongestConsecutiveDuplicateBlock(normalized, 200);
  if (fullDup) {
    return fullDup;
  }

  return normalized;
}

function collapseLikelyEchoDoubles(text: string): string {
  if (!text) {
    return text;
  }
  const cjkChars = text.match(/[\u4e00-\u9fff]/g) || [];
  if (cjkChars.length < 60) {
    return text;
  }
  const doubled = text.match(/([\u4e00-\u9fff])\1/g) || [];
  const ratio = doubled.length / cjkChars.length;
  // Only normalize when duplication is widespread (likely stream echo artifact).
  if (ratio < 0.18) {
    return text;
  }
  return text.replace(/([\u4e00-\u9fff])\1/g, '$1');
}

function findLongestConsecutiveDuplicateBlock(text: string, minLen: number): string {
  // If output is "A + A + A", keep one clean copy.
  for (let len = Math.floor(text.length / 2); len >= minLen; len--) {
    const head = text.slice(0, len).trim();
    if (!head) continue;
    const repeatedTwice = `${head}${head}`;
    if (text.replace(/\s+/g, '') === repeatedTwice.replace(/\s+/g, '')) {
      return head;
    }
    const repeatedThrice = `${head}${head}${head}`;
    if (text.replace(/\s+/g, '') === repeatedThrice.replace(/\s+/g, '')) {
      return head;
    }
  }
  return '';
}

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: 'gui-operate',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_displays',
        description: 'Get information about all connected displays. Returns display index, name, resolution, position, and scale factor. Use this to understand the multi-monitor setup before performing GUI operations.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'click',
        description: 'Perform a mouse click at specified coordinates. Supports single click, double click, right click, and triple click. Coordinates are display-local logical coordinates by default. You can also pass normalized coordinates (0-1000) via coordinate_type.',
        inputSchema: {
          type: 'object',
          properties: {
            coordinate_type: {
              type: 'string',
              enum: ['auto', 'absolute', 'normalized'],
              description: 'Coordinate interpretation. "absolute" = display-local logical coordinates. "normalized" = 0-1000 relative coordinates. "auto" (default) uses absolute, but converts from normalized if values are out of bounds.',
            },
            x: {
              type: 'number',
              description: 'X coordinate (interpretation depends on coordinate_type)',
            },
            y: {
              type: 'number',
              description: 'Y coordinate (interpretation depends on coordinate_type)',
            },
            display_index: {
              type: 'number',
              description: 'Display index (0 = main display). Use get_displays to see available displays. Default: 0',
            },
            click_type: {
              type: 'string',
              enum: ['single', 'double', 'right', 'triple'],
              description: 'Type of click to perform. Default: single',
            },
            modifiers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Modifier keys to hold during click: command, shift, option/alt, control/ctrl',
            },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'type_text',
        description: 'Type text at the current cursor/focus position. Supports Unicode (Chinese/Japanese/emoji) by automatically using clipboard paste (Cmd+V) when needed.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'The text to type',
            },
            press_enter: {
              type: 'boolean',
              description: 'Whether to press Enter after typing. Default: false',
            },
            input_method: {
              type: 'string',
              enum: ['auto', 'keystroke', 'paste'],
              description: 'Typing method. "auto" (default) uses clipboard paste for Unicode/CJK and keystroke for ASCII. Use "paste" to force clipboard paste. Use "keystroke" to force AppleScript keystroke.',
            },
            preserve_clipboard: {
              type: 'boolean',
              description: 'Whether to restore the previous clipboard after pasting (best-effort). Default: true',
            },
          },
          required: ['text'],
        },
      },
      {
        name: 'key_press',
        description: 'Press a key or key combination. Useful for special keys like Enter, Tab, Escape, arrow keys, or shortcuts like Cmd+C, Ctrl+C. For system shortcuts like Ctrl+C to interrupt programs, use key="c" with modifiers=["ctrl"].',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Key to press: enter, tab, escape, space, delete, up, down, left, right, home, end, pageup, pagedown, f1-f12, or a single character (a-z, 0-9, etc.)',
            },
            modifiers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Modifier keys (array of strings). Use: "ctrl" for Control, "cmd" for Command, "shift" for Shift, "alt" for Option. Example: ["ctrl"] for Ctrl+C, ["cmd", "shift"] for Cmd+Shift+Key.',
            },
          },
          required: ['key'],
        },
      },
      {
        name: 'scroll',
        description: 'Perform a scroll operation at the specified position.',
        inputSchema: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description: 'X coordinate to scroll at',
            },
            y: {
              type: 'number',
              description: 'Y coordinate to scroll at',
            },
            display_index: {
              type: 'number',
              description: 'Display index. Default: 0',
            },
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Scroll direction',
            },
            amount: {
              type: 'number',
              description: 'Scroll amount (number of lines). Default: 3',
            },
          },
          required: ['x', 'y', 'direction'],
        },
      },
      {
        name: 'drag',
        description: 'Perform a drag operation from one point to another. By default coordinates are normalized (0-1000) relative to the target display (top-left origin).',
        inputSchema: {
          type: 'object',
          properties: {
            coordinate_type: {
              type: 'string',
              enum: ['normalized', 'absolute'],
              description: 'Coordinate interpretation. "normalized" means 0-1000 relative coords on the display. "absolute" means display-local logical pixel coords. Default: normalized',
            },
            from_x: {
              type: 'number',
              description: 'Starting X coordinate (normalized 0-1000 by default)',
            },
            from_y: {
              type: 'number',
              description: 'Starting Y coordinate (normalized 0-1000 by default)',
            },
            to_x: {
              type: 'number',
              description: 'Ending X coordinate (normalized 0-1000 by default)',
            },
            to_y: {
              type: 'number',
              description: 'Ending Y coordinate (normalized 0-1000 by default)',
            },
            display_index: {
              type: 'number',
              description: 'Display index. Default: 0',
            },
          },
          required: ['from_x', 'from_y', 'to_x', 'to_y'],
        },
      },
      {
        name: 'screenshot',
        description: 'Take a screenshot of the screen, a specific display, or a region.',
        inputSchema: {
          type: 'object',
          properties: {
            output_path: {
              type: 'string',
              description: 'Path to save the screenshot. If not provided, saves to workspace directory.',
            },
            display_index: {
              type: 'number',
              description: 'Display index to capture. If not provided, captures all displays.',
            },
            region: {
              type: 'object',
              description: 'Capture a specific region',
              properties: {
                x: { type: 'number', description: 'X coordinate of region' },
                y: { type: 'number', description: 'Y coordinate of region' },
                width: { type: 'number', description: 'Width of region' },
                height: { type: 'number', description: 'Height of region' },
              },
              required: ['x', 'y', 'width', 'height'],
            },
          },
          required: [],
        },
      },
      {
        name: 'screenshot_for_display',
        description: 'Take a screenshot and return it as base64 image data for display in the response. Use this when you want to show key screenshots to the user in your reply. The screenshot will be embedded directly in the conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            display_index: {
              type: 'number',
              description: 'Display index to capture. If not provided, captures main display (0).',
            },
            region: {
              type: 'object',
              description: 'Capture a specific region',
              properties: {
                x: { type: 'number', description: 'X coordinate of region' },
                y: { type: 'number', description: 'Y coordinate of region' },
                width: { type: 'number', description: 'Width of region' },
                height: { type: 'number', description: 'Height of region' },
              },
              required: ['x', 'y', 'width', 'height'],
            },
            reason: {
              type: 'string',
              description: 'Optional description of why taking this screenshot (e.g., "showing current dialog state", "capturing error message"). This helps document the purpose of the screenshot.',
            },
            force_refresh: {
              type: 'boolean',
              description: 'If true, always capture a fresh screenshot and bypass short-term screenshot cache.',
            },
            annotate_clicks: {
              type: 'boolean',
              description: 'If true, annotate the screenshot with click history markers. Default: false',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_mouse_position',
        description: 'Get the current mouse cursor position, including which display it is on.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'move_mouse',
        description: 'Move the mouse cursor to a specified position without clicking.',
        inputSchema: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description: 'X coordinate',
            },
            y: {
              type: 'number',
              description: 'Y coordinate',
            },
            display_index: {
              type: 'number',
              description: 'Display index. Default: 0',
            },
          },
          required: ['x', 'y'],
        },
      },
      {
        name: 'wait',
        description: 'Wait for a specified duration in milliseconds. Use this to allow GUI applications to complete internal operations, animations, loading states, or asynchronous updates. Common use cases: waiting for dialogs to appear, menus to render, files to load, or network requests to complete.',
        inputSchema: {
          type: 'object',
          properties: {
            duration: {
              type: 'number',
              description: 'Duration to wait in milliseconds (e.g., 1000 = 1 second, 500 = 0.5 seconds)',
            },
            reason: {
              type: 'string',
              description: 'Optional description of why waiting (e.g., "waiting for dialog to appear", "waiting for file to load"). Helps with debugging and logging.',
            },
          },
          required: ['duration'],
        },
      },
      // {
      //   name: 'gui_plan_action',
      //   description: 'Plan GUI actions based on a natural language task description. Analyzes the current screen and breaks down the task into step-by-step GUI operations. Returns a plan with specific actions and element descriptions.',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       task_description: {
      //         type: 'string',
      //         description: 'Natural language description of the task to accomplish (e.g., "create a new file named a.py in Cursor", "click the Save button and enter filename")',
      //       },
      //       display_index: {
      //         type: 'number',
      //         description: 'Display index to analyze. If not provided, uses main display.',
      //       },
      //     },
      //     required: ['task_description'],
      //   },
      // },
      {
        name: 'gui_locate_element',
        description: 'Locate a GUI element on screen using AI vision. Returns the coordinates and confidence level for the element. You may need to re-call this function if you find previously found positions are not accurate (indicated by unsuccessful following operations).',
        inputSchema: {
          type: 'object',
          properties: {
            element_description: {
              type: 'string',
              description: 'Natural language description of the element to locate (e.g., "the red Start button", "the text input field labeled File Name")',
            },
            display_index: {
              type: 'number',
              description: 'Display index to search on. If not provided, uses main display.',
            },
          },
          required: ['element_description'],
        },
      },
      // {
      //   name: 'gui_interact_vision',
      //   description: 'Execute a GUI task using natural language description. Automatically plans the task into steps, locates elements, and executes actions. Example: "create a new file named a.py in Cursor" will automatically find the new file button, click it, locate the filename input, and type "a.py".',
      //   inputSchema: {
      //     type: 'object',
      //     properties: {
      //       task_description: {
      //         type: 'string',
      //         description: 'Natural language description of the complete task to accomplish (e.g., "create a new file named a.py", "click the Save button and enter filename test.txt", "open the File menu and select New")',
      //       },
      //       display_index: {
      //         type: 'number',
      //         description: 'Display index to operate on. If not provided, uses main display.',
      //       },
      //     },
      //     required: ['task_description'],
      //   },
      // },
      {
        name: 'gui_verify_vision',
        description: 'Verify GUI state using AI vision. Ask questions about what is visible on screen and get intelligent answers (e.g., "Is the game board visible?", "What is the current player shown?", "Are there any error messages?"). This tool is used to verify the state of the GUI after some operation to ensure the operation was successful (e.g., whether the click was successful, whether the text was typed, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'Question about the GUI state',
            },
            display_index: {
              type: 'number',
              description: 'Display index to verify. If not provided, uses main display.',
            },
          },
          required: ['question'],
        },
      },
      {
        name: 'get_all_visited_apps',
        description: 'Get a list of all applications that have been used before (have stored click history). IMPORTANT: You should call this BEFORE init_app to check if the app already exists and get the exact app name. This prevents creating duplicate directories due to name variations (e.g., "Cursor" vs "cursor" vs "Cursor IDE"). If the app you want is not in the list, you can use init_app with a new app name.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'init_app',
        description: 'Initialize app context for GUI operations. This MUST be called once before starting GUI operations on any application. IMPORTANT: Call get_all_visited_apps FIRST to check if the app already exists and get the exact app name to avoid creating duplicate directories. This tool loads the persistent click history and other app-specific data from disk. It also loads an optional per-app guide file at `<appDirectory>/guide.md` (if present) and returns its contents as `guide` so you can follow app-specific guidance. Each application has its own independent storage directory.',
        inputSchema: {
          type: 'object',
          properties: {
            app_name: {
              type: 'string',
              description: 'Name of the application (e.g., "Cursor", "Safari", "Terminal"). REQUIRED. Call get_all_visited_apps first to see previously used apps and get the exact name.',
            },
          },
          required: ['app_name'],
        },
      },
      {
        name: 'clear_click_history',
        description: 'Clear the click history for the current application. This removes all click markers from screenshots and deletes the persistent storage for this app. Use this when starting a completely new task or when you want to reset all visual markers.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    writeMCPLog(
      `[CallTool] name=${name}, args=${JSON.stringify(args ?? {})}`,
      'Tool Call'
    );

    let result: string;
    
    switch (name) {
      case 'get_displays': {
        const config = await getDisplayConfiguration();
        result = JSON.stringify(config, null, 2);
        break;
      }
      
      case 'click': {
        const { x, y, display_index = 0, click_type = 'single', modifiers = [], coordinate_type = 'auto' } = args as {
          x: number;
          y: number;
          display_index?: number;
          click_type?: 'single' | 'double' | 'right' | 'triple';
          modifiers?: string[];
          coordinate_type?: 'auto' | 'absolute' | 'normalized';
        };
        const resolved = await resolveClickCoordinates(x, y, display_index, coordinate_type);
        result = await performClick(resolved.x, resolved.y, display_index, click_type, modifiers);
        break;
      }
      
      case 'type_text': {
        const { text, press_enter = false, input_method = 'auto', preserve_clipboard = true } = args as {
          text: string;
          press_enter?: boolean;
          input_method?: 'auto' | 'keystroke' | 'paste';
          preserve_clipboard?: boolean;
        };
        result = await performType(text, press_enter, input_method, preserve_clipboard);
        break;
      }
      
      case 'key_press': {
        const { key, modifiers = [] } = args as {
          key: string;
          modifiers?: string[];
        };
        result = await performKeyPress(key, modifiers);
        break;
      }
      
      case 'scroll': {
        const { x, y, display_index = 0, direction, amount = 3 } = args as {
          x: number;
          y: number;
          display_index?: number;
          direction: 'up' | 'down' | 'left' | 'right';
          amount?: number;
        };
        result = await performScroll(x, y, display_index, direction, amount);
        break;
      }
      
      case 'drag': {
        const { from_x, from_y, to_x, to_y, display_index = 0, coordinate_type = 'normalized' } = args as {
          from_x: number;
          from_y: number;
          to_x: number;
          to_y: number;
          display_index?: number;
          coordinate_type?: 'normalized' | 'absolute';
        };

        let fromX = from_x;
        let fromY = from_y;
        let toX = to_x;
        let toY = to_y;

        if (coordinate_type !== 'absolute') {
          const from = await convertNormalizedToDisplayCoordinates(from_x, from_y, display_index);
          const to = await convertNormalizedToDisplayCoordinates(to_x, to_y, display_index);
          fromX = from.x;
          fromY = from.y;
          toX = to.x;
          toY = to.y;
        }

        result = await performDrag(fromX, fromY, toX, toY, display_index);
        break;
      }
      
      case 'screenshot': {
        const { output_path, display_index, region } = args as {
          output_path?: string;
          display_index?: number;
          region?: { x: number; y: number; width: number; height: number };
        };
        result = await takeScreenshot(output_path, display_index, region);
        break;
      }

      case 'screenshot_for_display': {
        const { display_index, region, reason, force_refresh } = args as {
          display_index?: number;
          region?: { x: number; y: number; width: number; height: number };
          reason?: string;
          force_refresh?: boolean;
        };
        // This tool returns a special format with image data, so return directly
        return await takeScreenshotForDisplay(display_index, region, reason, force_refresh === true);
      }

      case 'get_mouse_position': {
        const position = await getMousePosition();
        result = JSON.stringify(position, null, 2);
        break;
      }
      
      case 'move_mouse': {
        const { x, y, display_index = 0 } = args as {
          x: number;
          y: number;
          display_index?: number;
        };
        result = await moveMouse(x, y, display_index);
        break;
      }
      
      case 'wait': {
        const { duration, reason } = args as {
          duration: number;
          reason?: string;
        };
        result = await performWait(duration, reason);
        break;
      }
      
      case 'gui_plan_action': {
        const { task_description, display_index } = args as {
          task_description: string;
          display_index?: number;
        };
        const plan = await planGUIActions(task_description, display_index);
        result = JSON.stringify(plan, null, 2);
        break;
      }
      
      case 'gui_locate_element': {
        const { element_description, display_index } = args as {
          element_description: string;
          display_index?: number;
        };
        const location = await locateGUIElement(element_description, display_index);
        result = JSON.stringify(location, null, 2);
        break;
      }
      
      case 'gui_interact_vision': {
        const { task_description, display_index } = args as {
          task_description: string;
          display_index?: number;
        };
        result = await performVisionBasedInteraction(task_description, display_index);
        break;
      }
      
      case 'gui_verify_vision': {
        const { question, display_index } = args as {
          question: string;
          display_index?: number;
        };
        result = await verifyGUIState(question, display_index);
        break;
      }
      
      case 'init_app': {
        const { app_name } = args as {
          app_name: string;
        };
        
        if (!app_name) {
          throw new Error('app_name is required');
        }
        
        const initResult = await initApp(app_name);
        result = JSON.stringify({
          success: true,
          message: `Initialized app context for "${initResult.appName}"`,
          app_name: initResult.appName,
          app_directory: initResult.appDirectory,
          existing_clicks: initResult.clickCount,
          is_new_app: initResult.isNew,
          has_guide: initResult.hasGuide,
          guide_path: initResult.guidePath,
          guide: initResult.guide,
        });
        break;
      }
      
      case 'get_all_visited_apps': {
        const visitedApps = await getAllVisitedApps();
        result = JSON.stringify({
          success: true,
          visited_apps: visitedApps,
          count: visitedApps.length,
        });
        break;
      }
      
      case 'clear_click_history': {
        await clearClickHistory();
        result = JSON.stringify({
          success: true,
          message: `Click history cleared for app "${currentAppName}"`,
          app_name: currentAppName,
        });
        break;
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: true,
            message: error.message,
            tool: name,
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  try {
    writeMCPLog('=== GUI Operate MCP Server Starting ===', 'Initialization');
    writeMCPLog(`Node version: ${process.version}`, 'Initialization');
    writeMCPLog(`Platform: ${process.platform}`, 'Initialization');
    writeMCPLog(`Working directory: ${process.cwd()}`, 'Initialization');
    writeMCPLog(`Script path: ${__filename}`, 'Initialization');
    writeMCPLog(
      JSON.stringify({
        hasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
        hasOpenAIApiKey: Boolean(process.env.OPENAI_API_KEY),
        openAIBaseUrlHost: getBaseUrlHost(process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL),
        openAIModel: process.env.OPENAI_MODEL || '(unset)',
        anthropicModel: process.env.CLAUDE_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || '(unset)',
      }),
      'Initialization'
    );
    
    writeMCPLog('Creating StdioServerTransport...', 'Initialization');
    const transport = new StdioServerTransport();
    
    writeMCPLog('Connecting server to transport...', 'Initialization');
    await server.connect(transport);
    
    writeMCPLog('GUI Operate MCP Server running on stdio', 'Server Start');
    writeMCPLog('=== Server Ready ===', 'Server Start');
    writeMCPLog('Waiting for MCP requests...', 'Server Start');
    
    // Keep the process alive - server will handle MCP protocol messages
    // The transport handles the stdio communication automatically
    
    // No need for auto-save on exit - each click is saved individually
    process.on('SIGINT', () => {
      writeMCPLog('Received SIGINT, exiting...', 'Server Shutdown');
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      writeMCPLog('Received SIGTERM, exiting...', 'Server Shutdown');
      process.exit(0);
    });
    
    process.on('exit', (code) => {
      writeMCPLog(`Process exiting with code: ${code}`, 'Server Shutdown');
    });
    
    // Add unhandled rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      writeMCPLog(`Unhandled Rejection at: ${promise}, reason: ${reason}`, 'Error');
    });
    
    // Add uncaught exception handler
    process.on('uncaughtException', (error) => {
      writeMCPLog(`Uncaught Exception: ${error.message}\nStack: ${error.stack}`, 'Fatal Error');
      process.exit(1);
    });
    
  } catch (error) {
    writeMCPLog(`Error in main(): ${error instanceof Error ? error.message : String(error)}`, 'Fatal Error');
    if (error instanceof Error && error.stack) {
      writeMCPLog(`Stack trace: ${error.stack}`, 'Fatal Error');
    }
    throw error;
  }
}

// Add startup log before main execution
writeMCPLog('=== Script Loaded ===', 'Bootstrap');
writeMCPLog(`Module loaded, about to call main()`, 'Bootstrap');

main().catch((error) => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : 'No stack trace';
  writeMCPLog(`Fatal error in main(): ${errorMsg}`, 'Fatal Error');
  writeMCPLog(`Stack trace: ${stack}`, 'Fatal Error');
  process.exit(1);
});
