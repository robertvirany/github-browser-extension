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


document.querySelectorAll('.react-directory-truncate a.Link--primary').forEach(async file => {
  if (!file.getAttribute('aria-label')?.includes('(File)')) return; //skip dirs

  // Skip if bubble exists
  if (file.nextSibling && file.nextSibling.classList?.contains('loc-bubble')) return
  

  //Insert temporary bubble
  const bubble = document.createElement('span');
  bubble.className = 'loc-bubble';
  bubble.textContent = '...'; //loading
  file.insertAdjacentElement('afterend', bubble);

  // Fetch LOC and update
  const loc = await getLOC(file.href);
  if (loc !== null) {
    bubble.textContent = `${loc} loc`;
    bubble.title = `${loc} lines of code`;
  } else {
    bubble.textContent = '-';
    bubble.title = 'Could not fetch loc';
  }
});