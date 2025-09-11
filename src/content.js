function blobToRawUrl(blobUrl) {
  return blobUrl
    .replace('https://github.com/', 'https://raw.githubusercontent.com/')
    .replace('/blob/', '/');
}

async function getLOC(blobUrl) {
  const rawUrl = blobToRawUrl(blobUrl);
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) return null; //could be binary or deleted
    const text = await res.text();
    const lines = text.split('\n').length;
    return lines;
  } catch(err) {
    console.error('Failed to fetch file:', err);
    return null;
  }
}

async function getDirChildrenCount(fileHref) {
  // fileHref looks like /user/repo/tree/branch/path
  const m = fileHref.match(/^\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.*)$/);
  if (!m) return null;
  const [, owner, repo, branch, path] = m;

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github.v3+json' }
  });
  if (!res.ok) return null;

  const items = await res.json();
  return items.length;
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