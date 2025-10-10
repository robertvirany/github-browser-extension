function blobToRawUrl(blobUrl) {
  return blobUrl
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
}

function blobToSameOriginRaw(blobUrl) {
  try {
    const url = new URL(blobUrl);
    if (!url.pathname.includes('/blob/')) return null;
    url.pathname = url.pathname.replace('/blob/', '/raw/');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (err) {
    console.error('Failed to build same-origin raw URL:', err);
    return null;
  }
}

function countLines(text) {
  if (text === '') return 0;

  // Normalize line endings to Unix before splitting.
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip all trailing newline characters so blank placeholder rows don't inflate the count.
  normalized = normalized.replace(/\n+$/, '');
  if (normalized === '') return 0;

  return normalized.split('\n').length;
}

const fileLocCache = new Map();

async function getLOC(blobUrl) {
  if (fileLocCache.has(blobUrl)) {
    return fileLocCache.get(blobUrl);
  }

  const sameOriginRawUrl = blobToSameOriginRaw(blobUrl);
  const rawUrl = blobToRawUrl(blobUrl);

  try {
    if (sameOriginRawUrl) {
      const sameOriginRes = await fetch(sameOriginRawUrl, { credentials: 'same-origin' });
      if (sameOriginRes.ok) {
        const text = await sameOriginRes.text();
        const lines = countLines(text);
        fileLocCache.set(blobUrl, lines);
        return lines;
      }
    }

    const res = await fetch(rawUrl);
    if (res.ok) {
      const text = await res.text();
      const lines = countLines(text);
      fileLocCache.set(blobUrl, lines);
      return lines;
    }
  } catch (err) {
    console.error('Failed to fetch raw file:', err);
  }

  try {
    const fallbackRes = await fetch(blobUrl, { credentials: 'same-origin' });
    if (!fallbackRes.ok) {
      fileLocCache.set(blobUrl, null);
      return null;
    }

    const html = await fallbackRes.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const highlightedTable = doc.querySelector('table.js-file-line-container');
    if (highlightedTable) {
      const lines = [...highlightedTable.querySelectorAll('td.blob-code')].map(cell => cell.textContent ?? '');
      const count = countLines(lines.join('\n'));
      fileLocCache.set(blobUrl, count);
      return count;
    }

    const plain = doc.querySelector('pre');
    if (plain) {
      const count = countLines(plain.textContent);
      fileLocCache.set(blobUrl, count);
      return count;
    }
  } catch (err) {
    console.error('Failed to fetch file via blob page:', err);
  }

  fileLocCache.set(blobUrl, null);
  return null;
}

const dirCountCache = new Map();

async function getDirChildrenCount(fileHref) {
  if (dirCountCache.has(fileHref)) {
    return dirCountCache.get(fileHref);
  }

  // fileHref looks like /user/repo/tree/branch/path
  const m = fileHref.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  const [, owner, repo, branch, path = ''] = m;

  const pathSegments = path ? path.split('/').map(encodeURIComponent).join('/') : '';
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${pathSegments ? `/${pathSegments}` : ''}?ref=${branch}`;

  try {
    const apiRes = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (apiRes.ok) {
      const items = await apiRes.json();
      const count = Array.isArray(items) ? items.length : null;
      dirCountCache.set(fileHref, count);
      return count;
    }

    const pageRes = await fetch(fileHref, { credentials: 'same-origin' });
    if (!pageRes.ok) {
      dirCountCache.set(fileHref, null);
      return null;
    }

    const html = await pageRes.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const anchors = [...doc.querySelectorAll('.react-directory-truncate a.Link--primary')];
    const entries = anchors.filter(anchor => {
      const text = anchor.textContent.trim();
      if (text === '..') return false;
      const label = anchor.getAttribute('aria-label') || '';
      return label.includes('(File)') || label.includes('(Directory)');
    });
    const uniqueHrefs = new Set();
    entries.forEach(anchor => {
      const href = anchor.getAttribute('href');
      if (href) uniqueHrefs.add(href);
    });
    const count = uniqueHrefs.size;
    dirCountCache.set(fileHref, count);
    return count;
  } catch (err) {
    console.error('Failed to fetch directory listing:', err);
    dirCountCache.set(fileHref, null);
    return null;
  }
}



async function decorateEntry(file) {
  let wrapper = file.__locWrapper;
  if (!wrapper) {
    wrapper = document.createElement('span');
    wrapper.className = 'loc-bubble-wrapper';
    file.__locWrapper = wrapper;
  }

  const sibling = file.nextSibling;
  if (sibling?.classList?.contains('loc-bubble-wrapper') && sibling !== wrapper) {
    sibling.remove();
  }

  const contentHost = file.querySelector('.DirectoryRow-module__Box--uM44V');
  if (contentHost) {
    const existing = contentHost.querySelector(':scope > .loc-bubble-wrapper');
    if (existing && existing !== wrapper) existing.remove();
    if (!contentHost.contains(wrapper)) contentHost.appendChild(wrapper);
  }

  if (!contentHost && wrapper.previousSibling !== file) {
    file.insertAdjacentElement('afterend', wrapper);
  }

  let bubble = wrapper.querySelector('.loc-bubble');
  if (!bubble) {
    bubble = document.createElement('span');
    bubble.className = 'loc-bubble';
    wrapper.appendChild(bubble);
  }

  bubble.textContent = '...';

  const href = file.getAttribute('href');
  const aria = file.getAttribute('aria-label') || '';
  const ariaLower = aria.toLowerCase();
  const dataTestId = file.dataset.testid || '';
  const text = file.textContent.trim();

  const isParentLink = text === '..' || dataTestId === 'up-tree' || ariaLower.includes('parent directory');
  const isFile = ariaLower.includes('(file)') || dataTestId.startsWith('tree-item-file');
  const isDirectory =
    isParentLink ||
    ariaLower.includes('(directory)') ||
    ariaLower.includes('directory') ||
    ariaLower.includes('folder') ||
    dataTestId.startsWith('tree-item-dir');

  if (!href) {
    bubble.textContent = '-';
    bubble.title = 'Missing link target';
    return;
  }

  if (isFile && !isDirectory) {
    const loc = await getLOC(file.href);
    if (loc !== null) {
      bubble.textContent = `${loc} loc`;
      bubble.title = `${loc} lines of code`;
    } else {
      bubble.textContent = '-';
      bubble.title = 'Could not fetch loc';
    }
    return;
  }

  if (isDirectory) {
    const childCount = await getDirChildrenCount(href);
    if (childCount !== null) {
      bubble.textContent = `${childCount} items`;
      bubble.title = `${childCount} immediate children`;
    } else {
      bubble.textContent = '-';
      bubble.title = 'Could not fetch child count';
    }
    return;
  }

  bubble.textContent = '-';
  bubble.title = 'Unknown entry type';
}

const ENTRY_SELECTOR = [
  '.react-directory-truncate a.Link--primary',
  '.react-directory-truncate a.js-navigation-open',
  '.js-navigation-container a.Link--primary',
  '.js-navigation-container a.js-navigation-open',
  'a[data-testid="up-tree"]',
  'a[data-testid^="tree-item"]'
].join(', ');

async function decorateDirectoryList() {
  const entries = document.querySelectorAll(ENTRY_SELECTOR);
  await Promise.all([...entries].map(decorateEntry));
}

let directoryObserver;

let containerObserver;

function nodeContainsDirectoryEntry(node) {
  if (node instanceof Element) {
    if (node.matches('.react-directory-truncate, .js-navigation-container') && node.querySelector(ENTRY_SELECTOR)) {
      return true;
    }
    if (node.matches(ENTRY_SELECTOR)) {
      return true;
    }
    if (node.querySelector(ENTRY_SELECTOR)) {
      return true;
    }
    return false;
  }

  if (node instanceof DocumentFragment) {
    return Boolean(node.querySelector(ENTRY_SELECTOR));
  }

  return false;
}

function attachDirectoryObserver() {
  if (directoryObserver) {
    directoryObserver.disconnect();
  }

  directoryObserver = new MutationObserver(mutations => {
    let shouldDecorate = false;

    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (nodeContainsDirectoryEntry(node)) {
          shouldDecorate = true;
          break;
        }
      }
      if (shouldDecorate) break;
    }

    if (shouldDecorate) {
      queueMicrotask(() => decorateDirectoryList());
    }
  });

  directoryObserver.observe(document.body, {
    subtree: true,
    childList: true
  });
}

function waitForDirectoryContent() {
  const hasEntries = document.querySelector(ENTRY_SELECTOR);
  if (hasEntries) {
    decorateDirectoryList();
    attachDirectoryObserver();
    return;
  }

  if (!containerObserver) {
    containerObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        for (const node of mutation.addedNodes) {
          if (nodeContainsDirectoryEntry(node)) {
            containerObserver.disconnect();
            containerObserver = null;
            decorateDirectoryList();
            attachDirectoryObserver();
            return;
          }
        }
      }

      if (document.querySelector(ENTRY_SELECTOR)) {
        containerObserver.disconnect();
        containerObserver = null;
        decorateDirectoryList();
        attachDirectoryObserver();
      }
    });

    containerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

function init() {
  waitForDirectoryContent();
}

init();

document.addEventListener('turbo:load', () => {
  if (containerObserver) {
    containerObserver.disconnect();
    containerObserver = null;
  }
  if (directoryObserver) {
    directoryObserver.disconnect();
    directoryObserver = null;
  }
  waitForDirectoryContent();
});
