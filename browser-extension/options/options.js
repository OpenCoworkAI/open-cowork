/**
 * Open Cowork - Options Page Controller
 */

const $ = (sel) => document.querySelector(sel);

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupSave();
  setupConnections();
  setupDataManagement();
});

async function loadSettings() {
  const { settings } = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });

  $('#trackingEnabled').checked = settings.trackingEnabled !== false;
  $('#idleThreshold').value = settings.idleThresholdMinutes || 5;
  $('#dailyGoal').value = settings.dailyGoalMinutes || 480;
  $('#excludedDomains').value = (settings.excludedDomains || []).join('\n');
  $('#desktopApiUrl').value = settings.desktopApiUrl || 'http://localhost:3777';
  $('#syncEnabled').checked = settings.syncEnabled || false;
  $('#coeadaptApiUrl').value = settings.coeadaptApiUrl || '';
  $('#coeadaptApiKey').value = settings.coeadaptApiKey || '';
}

function setupSave() {
  $('#saveSettings').addEventListener('click', async () => {
    const settings = {
      trackingEnabled: $('#trackingEnabled').checked,
      idleThresholdMinutes: parseInt($('#idleThreshold').value, 10) || 5,
      dailyGoalMinutes: parseInt($('#dailyGoal').value, 10) || 480,
      excludedDomains: $('#excludedDomains').value
        .split('\n')
        .map((d) => d.trim())
        .filter(Boolean),
      desktopApiUrl: $('#desktopApiUrl').value.trim(),
      syncEnabled: $('#syncEnabled').checked,
      coeadaptApiUrl: $('#coeadaptApiUrl').value.trim(),
      coeadaptApiKey: $('#coeadaptApiKey').value.trim(),
    };

    await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });

    const status = $('#saveStatus');
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

function setupConnections() {
  $('#testDesktopConnection').addEventListener('click', async () => {
    const url = $('#desktopApiUrl').value.trim();
    const badge = $('#desktopStatus');
    try {
      const resp = await fetch(`${url}/api/health`, { method: 'GET' });
      if (resp.ok) {
        badge.textContent = 'Connected';
        badge.className = 'status-badge success';
      } else {
        badge.textContent = `Error ${resp.status}`;
        badge.className = 'status-badge error';
      }
    } catch {
      badge.textContent = 'Not reachable';
      badge.className = 'status-badge error';
    }
  });

  $('#testCoeadaptConnection').addEventListener('click', async () => {
    const url = $('#coeadaptApiUrl').value.trim();
    const key = $('#coeadaptApiKey').value.trim();
    const badge = $('#coeadaptStatus');
    if (!url) {
      badge.textContent = 'Enter URL first';
      badge.className = 'status-badge error';
      return;
    }
    try {
      const resp = await fetch(`${url}/api/v1/health`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.ok) {
        badge.textContent = 'Connected';
        badge.className = 'status-badge success';
      } else {
        badge.textContent = `Error ${resp.status}`;
        badge.className = 'status-badge error';
      }
    } catch {
      badge.textContent = 'Not reachable';
      badge.className = 'status-badge error';
    }
  });
}

function setupDataManagement() {
  $('#exportData').addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `open-cowork-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#clearData').addEventListener('click', async () => {
    if (confirm('Are you sure? This will delete all tracked data.')) {
      await chrome.storage.local.clear();
      alert('All data cleared.');
      location.reload();
    }
  });
}
