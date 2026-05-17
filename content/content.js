/*
  content/content.js
  - Läuft bei document_start
  - Prüft zuerst `shortlinks.json` und leitet sofort weiter wenn ein Treffer
  - Sonst: erkennt Klon-Seiten anhand von `redirect_rules` in `companies` oder `govs` und zeigt Overlay
  - Sonst: injiziert oben-rechts ein kleines UI-Badge mit farbigem Haken (grau/gold/blau)
*/

(function () {
  const KEYS = {
    bluemarks: "govverify:bluemarks",
    companies: "govverify:companies",
    govs: "govverify:govs",
    shortlinks: "govverify:shortlinks",
  };

  const ROOT_ID = "govverify-root";
  const OVERLAY_ID = "govverify-warning-overlay";

  // in-memory cache to avoid repeated storage reads
  let cache = { bluemarks: null, companies: null, govs: null, shortlinks: null };
  // keep closed shadow reference for tamper-resistance
  let uiRoot = null;
  let uiShadow = null;

  function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/:\d+$/, "");
  }

  function stripWww(host) {
    return normalizeHost(host).replace(/^www\./, "");
  }

  function getHostCandidates(host) {
    const normalized = normalizeHost(host);
    if (!normalized) return [];
    const parts = normalized.split(".").filter(Boolean);
    const candidates = [];
    for (let i = 0; i <= parts.length - 2; i++) candidates.push(parts.slice(i).join("."));
    return candidates;
  }

  function safeUrlFor(domain) {
    if (!domain) return "https://";
    try {
      return new URL(domain).href;
    } catch {
      return `https://${domain.replace(/^https?:\/\//i, "")}`;
    }
  }

  function getStorage(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res));
      } catch (e) {
        resolve({});
      }
    });
  }

  // fast shortlink check only (performed immediately)
  async function checkShortlinkNow(host) {
    try {
      const res = await getStorage([KEYS.shortlinks]);
      const shortlinks = res[KEYS.shortlinks]?.data || null;
      cache.shortlinks = shortlinks;
      if (!shortlinks) return null;
      const h = normalizeHost(host);
      // if shortlinks is an object map, check keys first for performance
      if (!Array.isArray(shortlinks) && typeof shortlinks === "object") {
        const candidates = getHostCandidates(host);
        candidates.unshift(stripWww(host));
        for (const c of candidates) {
          if (shortlinks[c]) return shortlinks[c];
        }
      }
      // fallback to array scan (small arrays are fast)
      for (const entry of shortlinks) {
        const domain = normalizeHost(entry.domain || entry.alias || entry.id || entry.alias);
        if (!domain) continue;
        if (h === domain || h.endsWith("." + domain)) return entry;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  // load remaining data in parallel but non-blocking
  async function populateCache() {
    try {
      const keys = [KEYS.bluemarks, KEYS.companies, KEYS.govs];
      const res = await getStorage(keys);
      cache.bluemarks = res[KEYS.bluemarks]?.data || cache.bluemarks;
      cache.companies = res[KEYS.companies]?.data || cache.companies;
      cache.govs = res[KEYS.govs]?.data || cache.govs;
    } catch (e) {
      // ignore - keep existing cache
    }
  }

  function findShortlinkFromCache(host) {
    const shortlinks = cache.shortlinks;
    if (!shortlinks) return null;
    const h = normalizeHost(host);
    if (!Array.isArray(shortlinks) && typeof shortlinks === "object") {
      const candidates = getHostCandidates(host);
      candidates.unshift(stripWww(host));
      for (const c of candidates) {
        if (shortlinks[c]) return shortlinks[c];
      }
    }
    for (const entry of shortlinks) {
      const domain = normalizeHost(entry.domain || entry.alias || entry.id || entry.alias);
      if (!domain) continue;
      if (h === domain || h.endsWith("." + domain)) return entry;
    }
    return null;
  }

  function iterateEntriesFast(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    if (typeof obj === "object") return Object.entries(obj); // return entries for map case
    return [];
  }

  // optimized lookup: if list is an object map, try direct key lookup using candidates
  function findEntryForHostOptimized(list, host) {
    if (!list) return null;
    const candidates = getHostCandidates(host);
    candidates.unshift(stripWww(host));
    if (!Array.isArray(list) && typeof list === "object") {
      for (const c of candidates) {
        if (list[c]) return list[c];
      }
      return null;
    }
    for (const entry of list) {
      const domain = entry.domain || entry.host || entry.id || entry.name || entry.org || entry.organization || "";
      const nd = normalizeHost(domain);
      if (!nd) continue;
      if (candidates.includes(nd)) return entry;
    }
    return null;
  }

  function findCloneRuleOptimized(entryOrList, host) {
    if (!entryOrList) return null;
    const candidates = getHostCandidates(host);
    candidates.unshift(stripWww(host));

    // if entryOrList is an object map of owners
    if (!Array.isArray(entryOrList) && typeof entryOrList === "object") {
      // check each owner entry via its key quickly
      for (const c of candidates) {
        const owner = entryOrList[c];
        if (!owner) continue;
        const rules = owner.redirect_rules || owner.redirectRules || owner.redirects || owner.clones || null;
        if (!rules) continue;
        if (Array.isArray(rules)) {
          for (const r of rules) {
            const ruleHost = normalizeHost(r.domain || r.host || r.clone_domain || r.malicious_domain || r.source || r);
            if (!ruleHost) continue;
            if (candidates.includes(ruleHost)) return { rule: r, owner };
          }
        } else if (typeof rules === "object") {
          for (const k of candidates) {
            if (rules[k]) return { rule: rules[k], owner };
          }
        }
      }
      // also scan owners' entries array if map values are arrays
      for (const owner of Object.values(entryOrList)) {
        const rules = owner.redirect_rules || owner.redirectRules || owner.redirects || owner.clones || null;
        if (!rules) continue;
        if (Array.isArray(rules)) {
          for (const r of rules) {
            const ruleHost = normalizeHost(r.domain || r.host || r.clone_domain || r.malicious_domain || r.source || r);
            if (!ruleHost) continue;
            if (candidates.includes(ruleHost)) return { rule: r, owner };
          }
        }
      }
      return null;
    }

    // array case
    const entries = Array.isArray(entryOrList) ? entryOrList : [entryOrList];
    for (const entry of entries) {
      if (!entry) continue;
      const rules = entry.redirect_rules || entry.redirectRules || entry.redirects || entry.clones || null;
      if (!rules) continue;
      if (Array.isArray(rules)) {
        for (const r of rules) {
          const ruleHost = normalizeHost(r.domain || r.host || r.clone_domain || r.malicious_domain || r.source || r);
          if (!ruleHost) continue;
          if (candidates.includes(ruleHost)) return { rule: r, owner: entry };
        }
      } else if (typeof rules === "object") {
        for (const key of candidates) {
          if (rules[key]) return { rule: rules[key], owner: entry };
        }
      }
    }
    return null;
  }

  function buildUI() {
    if (uiRoot) return uiRoot;

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.style.all = "initial";
    root.style.position = "fixed";
    root.style.top = "16px";
    root.style.right = "16px";
    root.style.zIndex = "2147483647";
    root.style.pointerEvents = "none";
    root.style.fontFamily = 'Inter, "Segoe UI", system-ui, sans-serif';

    // closed shadow to reduce risk of manipulation from page scripts; we keep a reference in uiShadow
    const shadow = root.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host{all:initial}
        .badge{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,0.95);box-shadow:0 8px 24px rgba(2,6,23,0.12);border:1px solid rgba(2,6,23,0.06);min-width:180px}
        .dot{width:12px;height:12px;border-radius:999px;flex:0 0 auto}
        .copy{overflow:hidden}
        .eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;color:#374151}
        .name{font-weight:800;font-size:13px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      </style>
      <div class="badge" id="govverify-badge" hidden>
        <div class="dot" id="govverify-dot"></div>
        <div class="copy">
          <div class="eyebrow">Verifiziert</div>
          <div class="name" id="govverify-name"></div>
        </div>
      </div>
      <div id="${OVERLAY_ID}" hidden>
        <style>
          .overlay-wrap{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:linear-gradient(180deg,rgba(0,0,0,0.6),rgba(0,0,0,0.75));}
          .panel{background:#7f1d1d;color:#fff;padding:28px;border-radius:18px;max-width:720px;width:calc(100% - 48px);box-shadow:0 28px 70px rgba(0,0,0,0.6)}
          .headline{font-size:28px;font-weight:800;margin:0}
          .message{margin-top:12px;font-size:16px}
          .actions{display:flex;gap:12px;margin-top:18px}
          .btn{padding:10px 14px;border-radius:999px;border:0;font-weight:700;cursor:pointer}
          .primary{background:#fff;color:#7f1d1d}
          .secondary{background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.18)}
        </style>
        <div class="overlay-wrap">
          <div class="panel">
            <h1 class="headline">Achtung! Dies ist eine nicht verifizierte Klon-Seite.</h1>
            <p class="message" id="govverify-warning-text"></p>
            <div class="actions">
              <button id="govverify-redirect" class="btn primary">Sicher zur Original-Domain</button>
              <button id="govverify-dismiss" class="btn secondary">Auf dieser Seite bleiben</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);
    uiRoot = root;
    uiShadow = shadow; // keep closed shadow reference
    return uiRoot;
  }

  function showBadge(name, color) {
    try {
      const root = buildUI();
      const shadow = uiShadow;
      if (!shadow) return;
      const badge = shadow.getElementById("govverify-badge");
      const dot = shadow.getElementById("govverify-dot");
      const nameNode = shadow.getElementById("govverify-name");
      if (!badge || !dot || !nameNode) return;
      nameNode.textContent = name || "Verifiziert";
      dot.style.background = color || "#9CA3AF";
      badge.hidden = false;
    } catch (e) {
      // ignore
    }
  }

  function showOverlay(originalDomain) {
    const root = buildUI();
    const shadow = uiShadow;
    if (!shadow) return;
    const overlay = shadow.getElementById(OVERLAY_ID);
    const text = shadow.getElementById("govverify-warning-text");
    const redirectBtn = shadow.getElementById("govverify-redirect");
    const dismissBtn = shadow.getElementById("govverify-dismiss");
    if (!overlay || !text || !redirectBtn) return;

    const safe = normalizeHost(originalDomain) || originalDomain || "die Original-Domain";
    text.textContent = `Wollten Sie zu ${safe}?`;
    redirectBtn.onclick = () => {
      const target = safeUrlFor(safe);
      try {
        chrome.runtime.sendMessage({ type: "govverify:safe-redirect", url: target });
      } catch (e) {
        window.location.href = target;
      }
    };
    dismissBtn.onclick = () => {
      overlay.hidden = true;
    };

    overlay.hidden = false;
    try {
      window.stop();
    } catch (e) {}
  }

  async function runChecks() {
    const host = normalizeHost(window.location.hostname);
    if (!host) return;

    // 1) shortlink check (fast, minimal blocking)
    const short = await checkShortlinkNow(host);
    if (short) {
      const target = short.url || short.target || short.destination || short.redirectTo || short.destinationUrl || null;
      if (target) {
        try {
          window.location.replace(target);
        } catch (e) {
          window.location.href = target;
        }
        return;
      }
    }

    // populate other data in background (non-blocking)
    void populateCache();

    // use cached data to perform clone detection and badge injection
    const companies = cache.companies;
    const govs = cache.govs;

    const cloneFromCompanies = findCloneRuleOptimized(companies, host);
    if (cloneFromCompanies) {
      const owner = cloneFromCompanies.owner;
      const rule = cloneFromCompanies.rule;
      const original = (rule && (rule.original_domain || rule.target_domain || rule.redirect_to || rule.safe_domain)) || owner.domain || owner.host || owner.website || null;
      showOverlay(original);
      return;
    }

    const cloneFromGovs = findCloneRuleOptimized(govs, host);
    if (cloneFromGovs) {
      const owner = cloneFromGovs.owner;
      const rule = cloneFromGovs.rule;
      const original = (rule && (rule.original_domain || rule.target_domain || rule.redirect_to || rule.safe_domain)) || owner.domain || owner.host || owner.website || null;
      showOverlay(original);
      return;
    }

    // badge injection: prioritize govs -> companies -> bluemarks
    const govEntry = findEntryForHostOptimized(cache.govs, host);
    if (govEntry) {
      const name = govEntry.name || govEntry.display_name || govEntry.organization || govEntry.domain || host;
      showBadge(name, "#9CA3AF");
      return;
    }

    const companyEntry = findEntryForHostOptimized(cache.companies, host);
    if (companyEntry) {
      const name = companyEntry.name || companyEntry.display_name || companyEntry.organization || companyEntry.domain || host;
      showBadge(name, "#D4AF37");
      return;
    }

    const blueEntry = findEntryForHostOptimized(cache.bluemarks, host);
    if (blueEntry) {
      const name = blueEntry.name || blueEntry.display_name || blueEntry.organization || blueEntry.issuer || host;
      showBadge(name, "#1DA1F2");
      return;
    }
  }

  // initial non-blocking run
  void runChecks();

  // SPA navigation hooks
  (function () {
    const origPush = history.pushState;
    history.pushState = function () {
      const ret = origPush.apply(this, arguments);
      setTimeout(() => void runChecks(), 50);
      return ret;
    };
    const origReplace = history.replaceState;
    history.replaceState = function () {
      const ret = origReplace.apply(this, arguments);
      setTimeout(() => void runChecks(), 50);
      return ret;
    };
    window.addEventListener("popstate", () => setTimeout(() => void runChecks(), 50), { passive: true });
  })();

  // keep cache up to date
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(changes)) {
      if (k === KEYS.shortlinks) cache.shortlinks = changes[k].newValue?.data || null;
      if (k === KEYS.companies) cache.companies = changes[k].newValue?.data || null;
      if (k === KEYS.govs) cache.govs = changes[k].newValue?.data || null;
      if (k === KEYS.bluemarks) cache.bluemarks = changes[k].newValue?.data || null;
    }
    // re-run checks quickly when data changes
    setTimeout(() => void runChecks(), 50);
  });
})();
