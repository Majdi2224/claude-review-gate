---
name: review-gate
description: Use in a repo with the review-gate hook installed — after finishing a chunk of code changes, enrich the auto-opened pull request with a clear, plain-language description before telling the user it's ready for review.
---

# review-gate: writing good PR descriptions

This project has the review-gate hook installed. Every time you finish
making edits and leave uncommitted changes, a script (`scripts/review-gate.js`,
run automatically as a `Stop` hook) commits them, pushes a branch, and opens
or updates a GitHub pull request. That part is guaranteed to happen whether
or not you follow this skill — it's a plain script, not something you need
to remember to trigger.

What the script cannot do well on its own is explain *why* something
changed, in language a reviewer who didn't watch you work can follow. That
part is yours. Whenever you finish a task that touched code in this repo:

0. **Timing matters.** The Stop hook only runs after your turn fully ends —
   it cannot have committed anything yet while you're still mid-response. If
   you're following this skill in the *same* turn where you just made edits,
   checking the PR right now would see stale data from before this edit and
   likely confuse you into thinking something's broken or into committing by
   hand (don't — that defeats the whole point of this tool). Instead, force
   review-gate to run synchronously first: find the project root (nearest
   `.git` folder), then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-gate.js"` piping in
   `{"cwd": "<project root>", "session_id": "<current session id, or \"manual\">"}`
   as JSON on stdin (this is exactly what `/ship` does, and what the Stop
   hook itself will do automatically once you stop — you're just doing it a
   few seconds early). *Then* continue with step 1 below. If you're instead
   picking this up at the start of a new turn — last turn already ended, so
   the Stop hook has already run — skip straight to step 1.
1. Check whether a PR exists for the current branch:
   `gh pr view --json number,url --jq '"\(.number) \(.url)"'`.
2. If one exists, replace its auto-generated body with a short, honest
   explanation: what changed, why, anything risky or worth a closer look,
   and anything you're unsure about. Update it with:
   `gh pr edit <number> --body "..."`.
3. Keep it short — a few sentences plus a bullet list of the notable or
   risky parts is enough. Don't restate the diff line by line; the diff is
   already attached to the PR.
4. Never claim something was tested unless you actually ran it.
5. End your reply to the person with exactly this shape, filled in — as its
   own clearly labeled block, not folded into other prose, and not skipped
   even though review-gate already printed its own note (they may not have
   seen it, and it doesn't include the "why"):

   ```
   Summary: <one or two plain-language sentences — what changed and why>
   PR link: <the PR URL>
   ```

Do not merge the PR yourself, and don't push directly to the base branch
(main/master) to "save a step" — the entire point of this tool is that a
human reviews and merges the change.
