(function () {
  const STORAGE_KEY = "veradomain:verify-catalog";

  const statusBox = document.getElementById("statusBox");
  const statusTitle = document.getElementById("statusTitle");
  const statusCopy = document.getElementById("statusCopy");
  const domainValue = document.getElementById("domainValue");
  const nameValue = document.getElementById("nameValue");
  const certValue = document.getElementById("certValue");
  const cacheValue = document.getElementById("cacheValue");
  const refreshButton = document.getElementById("refreshButton");

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeHost(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/:\d+$/, "");
  }

  function stripLeadingWww(hostname) {
    return normalizeHost(hostname).replace(/^www\./, "");
  }

  function setText(node, value) {
    node.textContent = value || "-";
  }

  async function readCatalog() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const payload = result[STORAGE_KEY];
      if (!isObject(payload) || !isObject(payload.data)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  function getVerifiedEntry(catalog, host) {
    if (!isObject(catalog)) {
      return null;
    }

    const entry = catalog[host] || catalog[stripLeadingWww(host)];
    if (!entry) {
      return null;
    }

    if (typeof entry === "string") {
      return {
        verifiedName: entry,
        certificateType: "Unbekannt",
      };
    }

    if (!isObject(entry)) {
      return null;
    }

    return {
      verifiedName:
        entry.verified_name ||
        entry.verifiedName ||
        entry.display_name ||
        entry.displayName ||
        entry.name ||
        entry.organization ||
        entry.org ||
        host,
      certificateType:
        entry.certificate_type ||
        entry.certificateType ||
        entry.cert_type ||
        entry.certType ||
        entry.type ||
        "Unbekannt",
    };
  }

  function getRedirectRule(catalog, host) {
    if (!isObject(catalog)) {
      return null;
    }

    const rules = catalog.redirect_rules || catalog.redirectRules || catalog.redirects || null;
    if (!rules) {
      return null;
    }

    if (Array.isArray(rules)) {
      return rules.find((rule) => {
        if (!isObject(rule)) {
          return false;
        }

        const candidate = normalizeHost(
          rule.domain || rule.host || rule.clone_domain || rule.cloneDomain || rule.source || rule.malicious_domain || rule.maliciousDomain
        );

        return candidate === host || candidate === stripLeadingWww(host);
      });
    }

    if (isObject(rules)) {
      return rules[host] || rules[stripLeadingWww(host)] || null;
    }

    return null;
  }

  function getOriginalDomain(rule) {
    if (typeof rule === "string") {
      return normalizeHost(rule);
    }

    if (!isObject(rule)) {
      return "";
    }

    return normalizeHost(
      rule.original_domain ||
        rule.originalDomain ||
        rule.target_domain ||
        rule.targetDomain ||
        rule.safe_domain ||
        rule.safeDomain ||
        rule.redirect_to ||
        rule.redirectTo ||
        rule.destination ||
        rule.destinationDomain ||
        rule.canonical_domain ||
        rule.canonicalDomain ||
        ""
    );
  }

  function formatTimestamp(value) {
    if (!value) {
      return "-";
    }

    try {
      return new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return "-";
    }
  }

  async function loadStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? normalizeHost(new URL(tab.url).hostname) : "";
    const catalog = await readCatalog();

    setText(domainValue, host || "Keine aktive URL");

    if (!catalog) {
      statusBox.className = "status";
      setText(statusTitle, "Kein Cache vorhanden");
      setText(statusCopy, "Die Erweiterung wartet auf die erste erfolgreiche JSON-Synchronisation.");
      setText(nameValue, "-");
      setText(certValue, "-");
      setText(cacheValue, "- / offline-tolerant");
      refreshButton.disabled = false;
      return;
    }

    const fetchedAt = formatTimestamp(catalog.fetchedAt);
    const redirectRule = getRedirectRule(catalog.data, host);
    const verifiedEntry = getVerifiedEntry(catalog.data, host);

    if (redirectRule) {
      const originalDomain = getOriginalDomain(redirectRule) || "Original-Domain unbekannt";
      statusBox.className = "status warning";
      setText(statusTitle, "Klon-Seite erkannt");
      setText(statusCopy, `Diese Domain ist in den Redirect-Regeln gelistet. Empfohlenes Ziel: ${originalDomain}.`);
      setText(nameValue, originalDomain);
      setText(certValue, "Warnung");
      setText(cacheValue, fetchedAt);
      refreshButton.disabled = false;
      return;
    }

    if (verifiedEntry) {
      statusBox.className = "status verified";
      setText(statusTitle, "Domain verifiziert");
      setText(statusCopy, "Die Hauptdomain wurde in der lokalen JSON-Liste gefunden.");
      setText(nameValue, verifiedEntry.verifiedName);
      setText(certValue, verifiedEntry.certificateType);
      setText(cacheValue, fetchedAt);
      refreshButton.disabled = false;
      return;
    }

    statusBox.className = "status";
    setText(statusTitle, "Keine Verifikation für diese Domain");
    setText(statusCopy, "Es liegt kein Eintrag in der lokalen JSON-Datei für die aktuelle Domain vor.");
    setText(nameValue, "-");
    setText(certValue, "-");
    setText(cacheValue, fetchedAt);
    refreshButton.disabled = false;
  }

  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    statusTitle.textContent = "Aktualisiere Cache ...";
    statusCopy.textContent = "Die JSON-Datei wird im Hintergrund neu geladen.";

    try {
      await chrome.runtime.sendMessage({ type: "uts:refresh-catalog" });
    } catch {
      // fallback to cached value below
    }

    await loadStatus();
  });

  loadStatus().catch(() => {
    statusBox.className = "status";
    setText(statusTitle, "Status nicht verfügbar");
    setText(statusCopy, "Die Erweiterung konnte den aktuellen Cache nicht lesen.");
    setText(domainValue, "-");
    setText(nameValue, "-");
    setText(certValue, "-");
    setText(cacheValue, "-");
    refreshButton.disabled = false;
  });
})();