# Security and repository sharing

Scrambo partner credentials are server secrets. Configure
`SCRAMBO_API_TOKEN` in the process environment or deployment secret manager;
never put a real value in a committed file, frontend JavaScript, browser
storage, URL, screenshot, fixture, or log.

The tracked `.env.example` files contain placeholders only. Local `.env*`
files, private keys, rendered media, logs, dependencies, and build output are
excluded by `.gitignore` and `.dockerignore`.

Before sharing a branch or archive:

1. Run `git status --short --ignored` and confirm no credential or customer
   media is staged or tracked.
2. Search tracked files and Git history with your organization's secret
   scanner. Pattern searches help but do not replace a purpose-built scanner.
3. Inspect `git remote -v`, commit authors, issue/PR references, and historical
   file names for organization-specific metadata you do not intend to share.
4. Build the archive from `git archive` or a fresh clone so ignored local files
   are not included.
5. Rotate any credential that was ever committed, even if a later commit
   removed it. Removing a file does not remove it from Git history.

The sample chat application's browser communicates only with its own backend.
The backend adds Scrambo's bearer credential when calling the upstream API and
does not expose that credential from `/api/config`.
