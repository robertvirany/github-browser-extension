GitHub Helper: LOC & Dir Counts (Edge Extension)

What it does
- Adds a small badge next to each entry in GitHub repository file lists.
- For files: shows lines of code (LOC), counted from the raw file.
- For directories: shows the number of immediate entries (files + subdirectories).

Install in Microsoft Edge
1. Build is not required — it’s a plain MV3 extension.
2. Open `edge://extensions`.
3. Enable “Developer mode”.
4. Click “Load unpacked” and select this folder.
5. Navigate to any GitHub repo page and the badges will appear.

TODO
- BUG: loc overcounts by 1
- Fix branches, HEAD is current version
- Add dir support
- Add caching to not piss off Github
- Make popup non-shit
- Make... faster?
- Icon
- BUG: getting "- loc" on robertvirany/dotfiles. Probably due to private repos? Could implement gh api fetching instead of normal file.href under const loc = to handle auth
- Add .. support
