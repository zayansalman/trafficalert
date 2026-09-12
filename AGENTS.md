# Working in this repo

`main` is the default branch and is always deployable. Nobody commits to it directly.

## Branch workflow

1. Pick an issue from the [issue tracker](https://github.com/zayansalman/trafficalert/issues).
2. Branch off `main`: `git checkout -b <short-description> main` (e.g. `chat-ui`, `openai-endpoint`).
3. Commit your work on that branch, push it, open a PR back into `main`.
4. Once it's reviewed and CI (if any) is green, merge the PR into `main` and delete the branch.

One issue, one branch, one PR. Keep branches short-lived — merge often rather than letting a
branch drift far from `main`.

## Checks

```
npm test     # vitest, colocated as foo.test.ts beside foo.ts
npm run lint
npm run build
```

Run all three before pushing.

## Current priorities

See the GitHub issues labeled `mvp:now` for what's being built right now, and `mvp:later` for
what's deliberately deferred.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
