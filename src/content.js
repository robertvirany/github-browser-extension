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
        const lines = text.split('\n').length;
        fileLocCache.set(blobUrl, lines);
        return lines;
      }
    }

    const res = await fetch(rawUrl);
    if (res.ok) {
      const text = await res.text();
      const lines = text.split('\n').length;
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
    const highlighted = doc.querySelectorAll('table.js-file-line-container tr');
    if (highlighted.length) {
      const count = highlighted.length;
      fileLocCache.set(blobUrl, count);
      return count;
    }

    const plain = doc.querySelector('pre');
    if (plain) {
      const count = plain.textContent.split('\n').length;
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



document.querySelectorAll('.react-directory-truncate a.Link--primary').forEach(async file => {

  // Skip if bubble exists
  if (file.nextSibling && file.nextSibling.classList?.contains('loc-bubble')) return
  
  //Insert temporary bubble
  const bubble = document.createElement('span');
  bubble.className = 'loc-bubble';
  bubble.textContent = '...'; //loading
  file.insertAdjacentElement('afterend', bubble);

  if (file.getAttribute('aria-label')?.includes('(File)')) {

    // Fetch LOC and update
    const loc = await getLOC(file.href);
    if (loc !== null) {
      bubble.textContent = `${loc} loc`;
      bubble.title = `${loc} lines of code`;
    } else {
      bubble.textContent = '-';
      bubble.title = 'Could not fetch loc';
    }
  }

  if (file.getAttribute('aria-label')?.includes('(Directory)')) {
    // implement dir logic. Basically if more than 2k loc show number of children

    const childCount = await getDirChildrenCount(file.getAttribute('href'));
    if (childCount !== null) {
      bubble.textContent = `${childCount} items`;
      bubble.title = `${childCount} immediate children`;
    } else {
      bubble.textContent = '-';
      bubble.title = 'Could not fetch child count';
    }

  }

});
