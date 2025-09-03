(() => {
  // Simple log helper
  const log = (...args) => console.debug('[GHH]', ...args);

  // In-memory + sessionStorage cache with simple TTL
  const memCache = new Map();
  const TTL_MS = 5 * 60 * 1000; // 5 minutes

  function cacheGet(key) {
    const now = Date.now();
    if (memCache.has(key)) {
      const { value, exp } = memCache.get(key);
      if (!exp || exp > now) return value;
    }
    try {
      const raw = sessionStorage.getItem('ghh:' + key);
      if (!raw) return undefined;
      const { v, e } = JSON.parse(raw);
      if (!e || e > now) {
        memCache.set(key, { value: v, exp: e });
        return v;
      }
    } catch {}
    return undefined;
  }

  function cacheSet(key, value, ttl = TTL_MS) {
    const exp = Date.now() + ttl;
    memCache.set(key, { value, exp });
    try {
      sessionStorage.setItem('ghh:' + key, JSON.stringify({ v: value, e: exp }));
    } catch {}
  }

  // Concurrency limiter
  function createLimiter(max = 4) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= max || queue.length === 0) return;
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then((v) => resolve(v), (e) => reject(e))
        .finally(() => {
          active--;
          next();
        });
    };
    return (fn) => new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  }

  const limit = createLimiter(4);

  // Try to detect rows reliably across GitHub UI changes
  function findFileListContainer(root = document) {
    // First, scope to the main repo content area if present
    const scopes = [
      'turbo-frame#repo-content-turbo-frame',
      '#repo-content-pjax-container',
      'main',
      'div[data-testid="repository-content"]',
      'div.repository-content'
    ];
    let scopeEl = null;
    for (const s of scopes) {
      const el = root.querySelector(s);
      if (el) { scopeEl = el; break; }
    }
    const scope = scopeEl || root;

    // Then, within that scope, try known file-list containers
    const selectors = [
      'section[aria-labelledby="files"]',
      'div[aria-labelledby="files"]',
      '[data-testid="filesystem-browser"]',
      'div[data-test-selector="files-container"]',
      'div[role="treegrid"]',
      'table[role="grid"]',
      'div.js-navigation-container',
    ];
    for (const sel of selectors) {
      const el = scope.querySelector(sel);
      if (el) return el;
    }

    // No reliable file-list container found — avoid falling back to a broad
    // scope like `main` to prevent touching README render content.
    return null;
  }

  function findRows(container) {
    // Candidate queries from older and newer GitHub UIs
    const candidates = [
      'div[role="row"][data-test-selector="tree-row"]',
      'div[role="row"].react-directory-row',
      'div[role="rowgroup"] > div[role="row"]',
      'div[aria-labelledby="files"] [role="row"]',
      '[data-testid="filesystem-browser"] [role="row"]',
      'div.js-navigation-container > div.js-navigation-item',
      'div.Box > div.Box-row',
      'table[role="grid"] tbody tr',
      'main [role="row"]',
    ];
    for (const q of candidates) {
      const rows = Array.from(container.querySelectorAll(q));
      if (rows.length) return rows;
    }
    // No structured rows found — return empty and let caller decide.
    return [];
  }

  function extractMainLink(row) {
    // Prefer primary link in row
    const anchors = Array.from(row.querySelectorAll('a[href]'));
    const scored = anchors.map((a) => {
      let score = 0;
      const href = a.getAttribute('href') || '';
      if (/\/blob\//.test(href) || /\/tree\//.test(href)) score += 5;
      if (a.classList.contains('js-navigation-open') || a.classList.contains('Link--primary')) score += 3;
      if (a.closest('strong')) score += 1;
      return { a, score, href };
    }).sort((x, y) => y.score - x.score);
    return scored[0]?.a || null;
  }

  function isDirHref(href) { return /\/tree\//.test(href); }
  function isFileHref(href) { return /\/blob\//.test(href); }

  function ensureCounterEl(row, mainLink) {
    const span = document.createElement('span');
    span.className = 'ghh-counter badge';
    span.textContent = '…';

    // Default and most visible: place right after the filename/link
    if (mainLink) {
      mainLink.insertAdjacentElement('afterend', span);
      return span;
    }

    // Fallback: append near the right edge if we couldn't find the main link
    let right = row.querySelector('.ghh-row-right');
    if (!right) {
      right = document.createElement('span');
      right.className = 'ghh-row-right ghh-align-right';
      (row.querySelector('[role="gridcell"]:last-child') || row.lastElementChild || row).appendChild(right);
    }
    right.appendChild(span);
    return span;
  }

  async function countFileLOCFromRaw(blobHref) {
    // Convert /blob/ to /raw/
    const rawUrl = new URL(blobHref, location.origin);
    rawUrl.pathname = rawUrl.pathname.replace('/blob/', '/raw/');
    const key = 'file:' + rawUrl.pathname;
    const cached = cacheGet(key);
    if (typeof cached === 'number') return cached;
    const res = await fetch(rawUrl.toString(), { method: 'GET' });
    if (!res.ok) throw new Error('fetch ' + res.status);
    const text = await res.text();
    // Count newlines. If file ends without newline, add 1 for last line when non-empty
    let lines = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    if (text.length > 0 && (text[text.length - 1] !== '\n')) lines++;
    cacheSet(key, lines);
    return lines;
  }

  async function countDirEntriesFromHTML(treeHref) {
    const abs = new URL(treeHref, location.origin).toString();
    const key = 'dir:' + abs;
    const cached = cacheGet(key);
    if (typeof cached === 'number') return cached;

    const res = await fetch(abs, { method: 'GET' });
    if (!res.ok) throw new Error('fetch ' + res.status);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    // Derive strict child path prefixes from the current directory URL so we
    // only count direct children under this path, avoiding extra page links.
    let count = 0;
    try {
      const u = new URL(abs);
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?$/);
      if (m) {
        const owner = m[1];
        const repo = m[2];
        const branch = m[3];
        const dirPath = m[4] || '';
        const base = `/${owner}/${repo}/`;
        const prefixCore = `${branch}/${dirPath ? dirPath + '/' : ''}`;
        const prefixes = [
          base + 'blob/' + prefixCore,
          base + 'tree/' + prefixCore,
        ];

        const anchors = Array.from(doc.querySelectorAll('a[href]'));
        const seen = new Set();
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) continue;
          // Ignore full external links
          if (/^https?:\/\//i.test(href)) continue;
          const p = new URL(href, location.origin).pathname;
          for (const pref of prefixes) {
            if (p.startsWith(pref)) {
              const rest = p.slice(pref.length);
              // Direct children only: remaining path must be a single segment
              if (rest.length > 0 && !rest.includes('/')) {
                seen.add(p);
              }
            }
          }
        }
        count = seen.size;
      }
    } catch (e) {
      log('dir count parse error', e);
    }

    // Fallback: try row-based counting if prefix logic failed
    if (!count) {
      const container = findFileListContainer(doc);
      const rows = container ? findRows(container) : [];
      count = rows.reduce((acc, row) => {
        const a = extractMainLink(row);
        if (!a) return acc;
        const href = a.getAttribute('href') || '';
        if (isDirHref(href) || isFileHref(href)) return acc + 1;
        return acc;
      }, 0);
    }

    cacheSet(key, count);
    return count;
  }

  function alreadyProcessed(row) {
    return !!row.dataset.ghhProcessed;
  }

  function markProcessed(row) {
    row.dataset.ghhProcessed = '1';
  }

  async function processRow(row) {
    if (alreadyProcessed(row)) return;
    const link = extractMainLink(row);
    if (!link) return;
    // Skip links inside README/article content
    if (link.closest('#readme, article.markdown-body')) return;
    const href = link.getAttribute('href');
    if (!href) return;
    const span = ensureCounterEl(row, link);
    markProcessed(row);

    if (isFileHref(href)) {
      try {
        const lines = await limit(() => countFileLOCFromRaw(href));
        span.textContent = `${lines.toLocaleString()} loc`;
        span.title = 'Lines of code (counted via raw content)';
      } catch (e) {
        span.textContent = '—';
        span.title = 'Failed to load LOC';
        log('file LOC error', href, e);
      }
    } else if (isDirHref(href)) {
      try {
        const items = await limit(() => countDirEntriesFromHTML(href));
        span.textContent = `${items.toLocaleString()} entries`;
        span.title = 'Direct children in this directory';
      } catch (e) {
        span.textContent = '—';
        span.title = 'Failed to count entries';
        log('dir count error', href, e);
      }
    } else {
      span.remove();
    }
  }

  async function processFileList(root = document) {
    // Restrict to repository root or /tree/... pages only
    const path = location.pathname;
    const treeLike = /^\/[^/]+\/[^/]+(?:\/tree\/[^/]+(?:\/.*)?)?$/;
    if (!treeLike.test(path)) return;

    const container = findFileListContainer(root);
    if (!container) {
      log('no container found');
      return;
    }
    let rows = findRows(container);
    if (!rows.length) {
      // Fallback: try obvious anchors within container
      const anchors = Array.from(
        container.querySelectorAll(
          ':scope :not(#readme):not(article.markdown-body) a[href*="/blob/"], '
          + ':scope :not(#readme):not(article.markdown-body) a[href*="/tree/"]'
        )
      );
      if (anchors.length) {
        rows = anchors.map((a) => a.closest('[role="row"], tr, .Box-row, .js-navigation-item') || a.parentElement).filter(Boolean);
      }
    }
    if (!rows.length) {
      log('no rows found in container');
      return;
    }
    rows.forEach((row) => processRow(row));
  }

  function setupObservers() {
    // Handle SPA navigations (pjax/turbo) and dynamic renders
    const run = () => processFileList();
    const debouncedRun = debounce(run, 200);

    // PJAX/Turbo events if present
    document.addEventListener('pjax:end', run, true);
    document.addEventListener('turbo:load', run, true);

    // Mutation observer for repo content area
    const target = document.body;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          // If repo content area changed, re-run
          if ([...m.addedNodes].some((n) =>
            n.nodeType === 1 && (
              n.id === 'repo-content-pjax-container' ||
              (n.tagName === 'TURBO-FRAME' && n.id === 'repo-content-turbo-frame') ||
              n.querySelector?.('#repo-content-pjax-container, turbo-frame#repo-content-turbo-frame')
            )
          )) {
            debouncedRun();
            return;
          }
        }
      }
      // Also occasionally run when many attributes change
      debouncedRun();
    });
    mo.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-turbo', 'data-pjax'] });

    // Initial run plus a brief retry loop to catch late renders
    run();
    let tries = 0;
    const maxTries = 14; // ~7s at 500ms
    const iv = setInterval(() => {
      tries++;
      run();
      if (tries >= maxTries) clearInterval(iv);
    }, 500);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Kickoff when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObservers, { once: true });
  } else {
    setupObservers();
  }
})();
