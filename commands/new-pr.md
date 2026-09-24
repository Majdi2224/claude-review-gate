---
description: Start a fresh branch and PR for a new feature/phase instead of continuing to add to the current one.
---

1. Find the project root (the nearest directory containing a `.git` folder).
2. Make sure there's nothing uncommitted first. If there is, let review-gate
   commit it — either end this turn normally and start a fresh one, or run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-gate.js"` directly the way
   `/ship` does — before continuing. Starting a new branch with uncommitted
   changes sitting around would silently carry them onto it.
3. Find `start-new-pr.js`: it's at
   `${CLAUDE_PLUGIN_ROOT}/scripts/start-new-pr.js` if that environment
   variable is set (a real plugin install), otherwise at
   `<project root>/.claude/scripts/start-new-pr.js` (the manual copy-files
   install) — check which one actually exists rather than assuming. Run it
   from the project root as:
   `node <that path> "<short-slug>"`
   — an optional one-to-three-word slug for what this new work is (e.g.
   `"auth"`, `"rate-limiting"`); leave it off for a plain timestamped branch.
4. Read its output: `OLD_BRANCH=...`, `NEW_BRANCH=...`, `BASE_BRANCH=...`.
   If it printed an error instead (uncommitted changes, not a git repo,
   couldn't create the branch), relay that plainly and stop.
5. Tell the person what happened: which branch/PR was left behind (if one
   has a PR, look it up with `gh pr view <OLD_BRANCH> --json url --jq .url`
   and give them the link so they know it's still there to review), and
   that a new PR will open once something is committed on the new branch.
