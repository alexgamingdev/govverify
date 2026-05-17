(function () {
  const HOST_ID = "uts-overlay-host";
  const STATE_COLORS = {
    gold: "#d4af37",
    gray: "#8a8f98",
    blue: "#2f80ed",
    neutral: "#c7ccd4",
  };

  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        pointer-events: none;
        contain: layout style paint;
        isolation: isolate;
        font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      .badge {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        background: linear-gradient(120deg, rgba(15, 18, 25, 0.82), rgba(20, 28, 42, 0.82));
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
        color: #f5f7fb;
        pointer-events: auto;
        isolation: isolate;
      }

      .icon {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: var(--state-color);
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--state-color) 22%, transparent);
        position: relative;
      }

      .icon::after {
        content: "";
        position: absolute;
        inset: 4px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.9);
      }

      .tooltip {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: min(300px, calc(100vw - 32px));
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(10, 12, 17, 0.96);
        color: #ffffff;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity 120ms ease, transform 120ms ease;
        pointer-events: none;
      }

      .badge:hover .tooltip {
        opacity: 1;
        transform: translateY(0);
      }

      .title {
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .meta {
        color: rgba(245, 247, 251, 0.78);
        margin-top: 4px;
      }
    </style>
    <div class="badge" part="badge">
      <span class="icon" part="icon"></span>
      <div>
        <div class="title" id="uts-title">Universal Trust Seal</div>
        <div class="meta" id="uts-meta">Prüft die Seite auf Vertrauenssignale</div>
      </div>
      <div class="tooltip" id="uts-tooltip">Verifiziert durch Universal Trust Seal: Identität des Inhabers kryptografisch bestätigt.</div>
    </div>
  `;

  const icon = shadow.querySelector(".icon");
  const title = shadow.getElementById("uts-title");
  const meta = shadow.getElementById("uts-meta");
  const tooltip = shadow.getElementById("uts-tooltip");

  async function refresh() {
    const response = await chrome.runtime.sendMessage({
      type: "uts:verify-current-page",
      url: location.href,
    });

    if (!response?.ok) {
      title.textContent = "Universal Trust Seal";
      meta.textContent = response?.error || "Verbindung zur Verifizierungslogik fehlt";
      icon.style.setProperty("--state-color", STATE_COLORS.neutral);
      tooltip.textContent = "Warnung: Die Seite konnte nicht verifiziert werden.";
      return;
    }

    const result = response.result;
    const color = STATE_COLORS[result.color] || STATE_COLORS.neutral;
    icon.style.setProperty("--state-color", color);
    title.textContent = result.trusted ? `Verifiziert · ${result.label}` : "Nicht verifiziert";
    meta.textContent = result.owner ? `Inhaber: ${result.owner}` : `Domain: ${result.recordDomain}`;
    tooltip.textContent = result.trusted
      ? `Verifiziert durch Universal Trust Seal: Identität des Inhabers kryptografisch bestätigt.${result.warning ? ` ${result.warning}` : ""}`
      : "Warnung: Für diese URL liegt kein verifizierter DNS-Record vor.";
  }

  let refreshTimer = 0;
  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refresh().catch(() => {
        icon.style.setProperty("--state-color", STATE_COLORS.neutral);
      });
    }, 250);
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    const result = originalPushState.apply(this, args);
    scheduleRefresh();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    const result = originalReplaceState.apply(this, args);
    scheduleRefresh();
    return result;
  };

  window.addEventListener("popstate", scheduleRefresh, { passive: true });
  window.addEventListener("hashchange", scheduleRefresh, { passive: true });

  document.documentElement.appendChild(host);
  refresh().catch(() => {
    icon.style.setProperty("--state-color", STATE_COLORS.neutral);
  });
})();