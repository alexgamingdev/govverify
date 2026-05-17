(function () {
  const BADGE_CLASS = "uts-google-badge";
  const PROCESSED_ATTR = "data-uts-google-processed";
  const pendingCards = new Set();
  const domainCache = new Map();
  let scheduled = false;

  function resolveDomainFromCard(card) {
    const link = card.querySelector("a[href^='http']");
    if (!link) {
      return null;
    }

    try {
      const parsed = new URL(link.href);
      return {
        link,
        domain: parsed.hostname.toLowerCase(),
      };
    } catch {
      return null;
    }
  }

  function getResultCards(root) {
    const candidates = root.querySelectorAll("#search .MjjYud, #search .tF2Cxc, #search .g");
    return Array.from(candidates);
  }

  function createBadge(result) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.justifyContent = "center";
    badge.style.width = "16px";
    badge.style.height = "16px";
    badge.style.marginInlineStart = "8px";
    badge.style.borderRadius = "999px";
    badge.style.boxShadow = "0 0 0 2px rgba(255, 255, 255, 0.95)";

    if (result.color === "gold") {
      badge.style.background = "#d4af37";
    } else if (result.color === "blue") {
      badge.style.background = "#1d9bf0";
    } else {
      badge.style.background = "#8a8f98";
    }

    badge.style.color = "#ffffff";

    badge.innerHTML = `
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M9.2 16.2 4.8 11.8l1.8-1.8 2.6 2.6 8.2-8.2 1.8 1.8-10 10z" fill="currentColor"></path>
      </svg>
    `;
    badge.title = result.owner
      ? `Verifiziert (${result.owner})`
      : "Verifiziert durch Universal Trust Seal";
    return badge;
  }

  async function verifyDomain(domain) {
    if (domainCache.has(domain)) {
      return domainCache.get(domain);
    }

    const lookupPromise = chrome.runtime
      .sendMessage({ type: "uts:verify-url", url: domain })
      .then((response) => {
        if (!response?.ok || !response.result?.trusted) {
          return null;
        }

        return response.result;
      })
      .catch(() => null);

    domainCache.set(domain, lookupPromise);
    return lookupPromise;
  }

  async function decorateCard(card) {
    if (card.getAttribute(PROCESSED_ATTR) === "true") {
      return;
    }

    card.setAttribute(PROCESSED_ATTR, "true");
    const data = resolveDomainFromCard(card);
    if (!data?.domain) {
      return;
    }

    const verified = await verifyDomain(data.domain);
    if (!verified) {
      return;
    }

    const title = card.querySelector("h3") || data.link;
    if (!title || title.querySelector(`.${BADGE_CLASS}`)) {
      return;
    }

    title.appendChild(createBadge(verified));
  }

  async function flushPending() {
    scheduled = false;
    const cards = Array.from(pendingCards);
    pendingCards.clear();
    await Promise.allSettled(cards.map((card) => decorateCard(card)));
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
    for (const card of getResultCards(root)) {
      pendingCards.add(card);
    }

    if (pendingCards.size) {
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
      scrollTimer = window.setTimeout(() => scan(document), 160);
    },
    { passive: true }
  );

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();