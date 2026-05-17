(function () {
  const BADGE_CLASS = "uts-x-badge";
  const BADGED_ATTR = "data-uts-badge-rendered";
  const MAX_RETRIES = 10;
  const domainResultCache = new Map();
  const pendingNameBlocks = new Set();
  const attemptsByBlock = new WeakMap();
  let scheduled = false;

  function normalizeHost(host) {
    return String(host || "").toLowerCase().replace(/^www\./, "");
  }

  function isExternalDomain(host) {
    const normalized = normalizeHost(host);
    if (!normalized) {
      return false;
    }

    return normalized !== "x.com" && normalized !== "twitter.com" && normalized !== "t.co";
  }

  function extractDomainFromLink(link) {
    try {
      const parsed = new URL(link.href);
      if (!isExternalDomain(parsed.hostname)) {
        return null;
      }

      return normalizeHost(parsed.hostname);
    } catch {
      return null;
    }
  }

  function createBadge(result) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.setAttribute("aria-label", "Verifizierter Account");
    badge.title = result.owner
      ? `Verifiziert: ${result.owner}`
      : "Verifiziert durch Universal Trust Seal";
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.width = "16px";
    badge.style.height = "16px";
    badge.style.borderRadius = "999px";
    badge.style.background = result.color === "gold" ? "#d4af37" : result.color === "gray" ? "#8a8f98" : "#1d9bf0";
    badge.style.boxShadow = "0 0 0 2px rgba(255, 255, 255, 0.9)";
    badge.style.marginInlineStart = "7px";
    badge.style.verticalAlign = "middle";
    badge.style.color = "#ffffff";
    badge.style.flex = "0 0 auto";
    badge.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M9.2 16.2 4.8 11.8l1.8-1.8 2.6 2.6 8.2-8.2 1.8 1.8-10 10z" fill="currentColor"></path>
      </svg>
    `;
    return badge;
  }

  async function verifyDomain(domain) {
    if (domainResultCache.has(domain)) {
      return domainResultCache.get(domain);
    }

    const promise = chrome.runtime
      .sendMessage({
        type: "uts:verify-url",
        url: domain,
      })
      .then((response) => {
        if (!response?.ok || !response.result?.trusted) {
          return null;
        }

        return response.result;
      })
      .catch(() => null);

    domainResultCache.set(domain, promise);
    return promise;
  }

  function findNameAnchor(userNameBlock) {
    const preferred = userNameBlock.querySelector("span[dir='ltr']") || userNameBlock.querySelector("span[dir='auto']");
    return preferred || userNameBlock;
  }

  function findDomainForUserBlock(userNameBlock) {
    const localContainer = userNameBlock.closest("article, div[data-testid='UserCell'], section, main, header") || document;
    const searchRoots = [
      localContainer,
      localContainer.parentElement,
      document,
    ].filter(Boolean);

    const seenLinks = new Set();

    for (const root of searchRoots) {
      const links = root.querySelectorAll("div[data-testid='UserDescription'] a[href^='http'], a[title][href^='http'], a[href^='http']");
      for (const link of links) {
        if (seenLinks.has(link)) {
          continue;
        }

        seenLinks.add(link);
        const domain = extractDomainFromLink(link);
        if (domain) {
          return domain;
        }
      }
    }

    return null;
  }

  async function processUserNameBlock(userNameBlock) {
    if (!userNameBlock || userNameBlock.getAttribute(BADGED_ATTR) === "true") {
      return;
    }

    const attempts = attemptsByBlock.get(userNameBlock) || 0;
    if (attempts >= MAX_RETRIES) {
      return;
    }

    const domain = findDomainForUserBlock(userNameBlock);
    if (!domain) {
      attemptsByBlock.set(userNameBlock, attempts + 1);
      return;
    }

    const result = await verifyDomain(domain);
    if (!result) {
      attemptsByBlock.set(userNameBlock, attempts + 1);
      return;
    }

    const anchor = findNameAnchor(userNameBlock);
    if (!anchor || anchor.querySelector(`.${BADGE_CLASS}`)) {
      return;
    }

    anchor.appendChild(createBadge(result));
    userNameBlock.setAttribute(BADGED_ATTR, "true");
  }

  async function flushPending() {
    scheduled = false;
    const blocks = Array.from(pendingNameBlocks);
    pendingNameBlocks.clear();
    await Promise.allSettled(blocks.map((block) => processUserNameBlock(block)));
  }

  function scheduleFlush() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      flushPending().catch(() => {
        scheduled = false;
      });
    });
  }

  function scan(root = document) {
    const blocks = root.querySelectorAll ? root.querySelectorAll("div[data-testid='UserName']") : [];
    for (const block of blocks) {
      pendingNameBlocks.add(block);
    }

    if (pendingNameBlocks.size) {
      scheduleFlush();
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }

        scan(node);
      }
    }
  });

  let scrollTimer = 0;
  window.addEventListener(
    "scroll",
    () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => scan(document), 180);
    },
    { passive: true }
  );

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
