/**
 * Open Cowork - Content Script
 *
 * Runs on every page to detect user engagement signals:
 * - Scroll depth (are they actually reading?)
 * - Typing activity (are they coding/writing?)
 * - Video playback (are they watching tutorials?)
 * - Active interaction time
 *
 * Sends lightweight signals back to the background service worker.
 */

(() => {
  // Debounce helper
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // Track engagement signals
  const signals = {
    scrollDepthPercent: 0,
    hasTyped: false,
    hasVideoPlaying: false,
    interactionCount: 0,
    maxScrollY: 0,
  };

  // Scroll depth tracking
  const onScroll = debounce(() => {
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight > 0) {
      const depth = Math.round((window.scrollY / scrollHeight) * 100);
      signals.scrollDepthPercent = Math.max(signals.scrollDepthPercent, depth);
      signals.maxScrollY = Math.max(signals.maxScrollY, window.scrollY);
    }
    signals.interactionCount++;
  }, 200);

  // Typing detection
  const onKeydown = debounce(() => {
    signals.hasTyped = true;
    signals.interactionCount++;
  }, 500);

  // Click tracking
  const onClick = debounce(() => {
    signals.interactionCount++;
  }, 300);

  // Video detection
  function checkForVideo() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!video.paused && !video.ended) {
        signals.hasVideoPlaying = true;
        return;
      }
    }
    signals.hasVideoPlaying = false;
  }

  // Register listeners
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKeydown, { passive: true });
  document.addEventListener('click', onClick, { passive: true });

  // Periodically check video state and send signals
  const intervalId = setInterval(() => {
    checkForVideo();

    // Only send if there's meaningful activity
    if (signals.interactionCount > 0 || signals.hasVideoPlaying) {
      chrome.runtime.sendMessage({
        type: 'CONTENT_ACTIVITY',
        tabId: undefined, // Background script matches by sender
        title: document.title,
        contentSignals: { ...signals },
      }).catch(() => {
        // Extension context may be invalidated
      });
    }
  }, 30000); // Every 30 seconds

  // Send initial page info
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'CONTENT_ACTIVITY',
      title: document.title,
      contentSignals: { ...signals },
    }).catch(() => {});
  }, 2000);

  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    clearInterval(intervalId);
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onClick);
  });
})();
