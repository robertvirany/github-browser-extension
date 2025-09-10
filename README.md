GitHub Helper: LOC & Dir Counts (Edge Extension)

What it does
- Adds a small badge next to each entry in GitHub repository file lists.
- For files: shows lines of code (LOC), counted from the raw file.
- For directories: shows the number of immediate entries (files + subdirectories).
- Handles GitHub’s SPA navigation via DOM observers so it works as you click around.

Install in Microsoft Edge
1. Build is not required — it’s a plain MV3 extension.
2. Open `edge://extensions`.
3. Enable “Developer mode”.
4. Click “Load unpacked” and select this folder.
5. Navigate to any GitHub repo page and the badges will appear.

How it works
- Content script (`src/content.js`) runs on `https://github.com/*`.
- It locates file list rows and injects a small badge element.
- Files: converts the `/blob/` link to `/raw/` and counts newlines.
- Directories: fetches the directory page’s HTML and counts entries in the list.
- Uses a small in-memory + `sessionStorage` cache for 5 minutes to avoid refetching.
- Throttles concurrent network requests to avoid overwhelming GitHub.

Notes & limitations
- Large/binary files: The extension reads the raw content; binary files may count oddly — the badge will still show a number, but it may not be meaningful. You can ignore these.
- If GitHub significantly changes DOM structure, selectors may need updates. The script tries multiple fallbacks to remain robust.
- No authentication is used; private repos will work as long as you are logged into GitHub in that Edge profile.

Development
- The code is plain JS/CSS — no build step. Modify files under `src/` and reload the extension.
- Open DevTools on a GitHub tab to see `[GHH]` logs.

TODO
- Add dir support
- Add caching to not piss off Github
- Make popup non-shit
- Add caching