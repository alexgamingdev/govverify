/*
  background.js (service worker)
  - Lädt vier JSON-Dateien asynchron beim Start und alle 6 Stunden
  - Speichert jede Datei separat in chrome.storage.local
  - Bei Fetch-Fehlern bleiben die alten Daten erhalten
  - Reagiert auf Nachrichten zum Abrufen oder manuellen Refetch
*/

// Use your GitHub Pages site as the source for the JSON files
const BASE = "https://alexgamingdev.github.io/govverify";
const SOURCES = [
  { key: "govverify:bluemarks", url: `${BASE}/bluemarks.json` },
  { key: "govverify:companies", url: `${BASE}/companies.json` },
  { key: "govverify:govs", url: `${BASE}/govs.json` },
  { key: "govverify:gk", url: `${BASE}/gk.json` },
  { key: "govverify:shortlinks", url: `${BASE}/shortlinks.json` },
];

const ALARM_NAME = "govverify-refresh-all";
const REFRESH_INTERVAL_MINUTES = 6 * 60; // 6 Stunden

function isObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("govverify: fetch failed", url, err);
    return null;
  }
}

async function fetchAndCache(source) {
  const { key, url } = source;
  const json = await fetchJson(url);
  if (json === null) {
    // fetch failed -> keep existing cache
    return false;
  }

  const payload = {
    url,
    fetchedAt: Date.now(),
    data: json,
  };

  try {
    await chrome.storage.local.set({ [key]: payload });
    return true;
  } catch (err) {
    console.error("govverify: storage.set failed", key, err);
    return false;
  }
}

async function refreshAll() {
  const results = {};
  await Promise.all(
    SOURCES.map(async (s) => {
      const ok = await fetchAndCache(s);
      results[s.key] = ok;
    })
  );
  return results;
}

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
}

async function initialize() {
  ensureAlarm();
  // Try to fetch, but tolerate failures (keep cached data)
  await refreshAll();
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize();
});

chrome.runtime.onStartup.addListener(() => {
  void initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void refreshAll();
  }
});

// messaging: allow content scripts to request data or force refresh
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isObject(message)) return false;

  if (message.type === "govverify:get") {
    // message.name = one of the keys without prefix ("bluemarks","companies","govs","shortlinks")
    (async () => {
      const name = String(message.name || "").trim();
      const mapping = {
        bluemarks: "govverify:bluemarks",
        companies: "govverify:companies",
        gk: "govverify:gk",
        govs: "govverify:govs",
        shortlinks: "govverify:shortlinks",
      };
      const key = mapping[name] || message.key;
      if (!key) {
        sendResponse({ ok: false, error: "missing_key" });
        return;
      }

      try {
        // If the caller requests a fresh fetch, do not rely on storage — fetch from the remote URL.
        if (message.fresh) {
          const src = SOURCES.find((s) => s.key === key);
          if (src) {
            const json = await fetchJson(src.url);
            if (json !== null) {
              sendResponse({ ok: true, payload: { url: src.url, fetchedAt: Date.now(), data: json } });
              return;
            }
            // fallback to stored data if fetch fails
            const storedFallback = await chrome.storage.local.get(key);
            sendResponse({ ok: true, payload: storedFallback[key] || null });
            return;
          }
        }

        const stored = await chrome.storage.local.get(key);
        sendResponse({ ok: true, payload: stored[key] || null });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  if (message.type === "govverify:refresh") {
    (async () => {
      const res = await refreshAll();
      sendResponse({ ok: true, result: res });
    })();
    return true;
  }

  if (message.type === "govverify:safe-redirect") {
    (async () => {
      try {
        const tabId = sender?.tab?.id;
        const url = String(message.url || "").trim();
        if (!tabId || !url) {
          sendResponse({ ok: false });
          return;
        }
        await chrome.tabs.update(tabId, { url });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  return false;
});
