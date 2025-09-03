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
    const selectors = [
      'turbo-frame#repo-content-turbo-frame',
      '#repo-content-pjax-container',
      'div[data-testid="repository-content"]',
      'div[data-target="react-app.embeddedContainer"]',
      'div.repository-content'
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return root.body || root;
  }

  function findRows(container) {
    // Candidate queries from older and newer GitHub UIs
    const candidates = [
      'div[role="row"][data-test-selector="tree-row"]',
      'div[role="row"].react-directory-row',
      'div.js-navigation-container > div.js-navigation-item',
      'div.Box > div.Box-row',
      'table[role="grid"] tbody tr',
      'div[aria-labelledby="files"] [role="row"]',
    ];
    for (const q of candidates) {
      const rows = Array.from(container.querySelectorAll(q));
      if (rows.length) return rows;
    }
    // Fallback: visible links to blob/tree grouped by nearest row-like parent
    const links = Array.from(container.querySelectorAll('a[href]'))
      .filter((a) => /\/blob\//.test(a.getAttribute('href')) || /\/tree\//.test(a.getAttribute('href')));
    const rows = new Set();
    for (const a of links) {
      let p = a.parentElement;
      while (p && p !== container) {
        const isRow = p.matches?.('div, tr, li, article');
        if (isRow) { rows.add(p); break; }
        p = p.parentElement;
      }
    }
    return Array.from(rows);
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

  function ensureCounterEl(row) {
    // Try to append to a right-aligned cell/area when it exists
    let right = row.querySelector('.ghh-row-right');
    if (!right) {
      right = document.createElement('span');
      right.className = 'ghh-row-right ghh-align-right';
      // Prefer appending near the end
      (row.querySelector('[role="gridcell"]:last-child') || row.lastElementChild || row).appendChild(right);
    }
    const span = document.createElement('span');
    span.className = 'ghh-counter badge';
    span.textContent = '…';
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
    const container = findFileListContainer(doc);
    const rows = findRows(container);
    // Count only rows that have a main link to blob/tree
    const count = rows.reduce((acc, row) => {
      const a = extractMainLink(row);
      if (!a) return acc;
      const href = a.getAttribute('href') || '';
      if (isDirHref(href) || isFileHref(href)) return acc + 1;
      return acc;
    }, 0);
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
    const href = link.getAttribute('href');
    if (!href) return;
    const span = ensureCounterEl(row);
    markProcessed(row);

    if (isFileHref(href)) {
      try {
        const lines = await limit(() => countFileLOCFromRaw(href));
        span.textContent = `${lines.toLocaleString()} LOC`;
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
    const container = findFileListContainer(root);
    if (!container) return;
    const rows = findRows(container);
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

    // Initial run
    run();
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

