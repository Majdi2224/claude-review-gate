---
description: Commit/push whatever is uncommitted right now and open or update a pull request, with a proper human-written description.
---

Run review-gate immediately instead of waiting for the end of the turn:

1. Find the project root (the nearest directory containing a `.git` folder).
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-gate.js"`, piping in
   `{"cwd": "<project root>", "session_id": "<current session id, or \"manual\">"}`
   as JSON on stdin — this mirrors what the Stop hook sends automatically.
3. If there's nothing uncommitted, just say so — don't force an empty commit.
4. Otherwise, once the script has committed/pushed/opened a PR, find it with
   `gh pr view --json number,url` and follow the `review-gate` skill to
   rewrite its description in plain language for a human reviewer.
5. Tell the user the PR link and a one-line summary of what's in it.
