# Working in this repo

`main` is the default branch and is always deployable. Nobody commits to it directly.

## Branch workflow

1. Pick an issue from the [issue tracker](https://github.com/zayansalman/trafficalert/issues).
2. Branch off `main`: `git checkout -b <short-description> main` (e.g. `chat-ui`, `openai-endpoint`).
3. Commit your work on that branch, push it, open a PR back into `main`.
4. Once it's reviewed and CI (if any) is green, merge the PR into `main` and delete the branch.

One issue, one branch, one PR. Keep branches short-lived — merge often rather than letting a
branch drift far from `main`.

## Current priorities

See the GitHub issues labeled `mvp:now` for what's being built right now, and `mvp:later` for
what's deliberately deferred.
