---
name: review-gate
description: Use in a repo with the review-gate hook installed. Two jobs — (1) before starting a new chunk of work, decide whether it belongs on the PR that's already open or needs a fresh one, and ask the person if it's not obvious; (2) after finishing, write a clear plain-language PR description and end your reply with a Summary/PR link block. Always relevant once you've made or are about to make code changes in a repo with review-gate installed.
---

# review-gate: keeping PRs one-feature-at-a-time, and describing them well

This project has the review-gate hook installed. Every time you finish
making edits and leave uncommitted changes, a script (`scripts/review-gate.js`,
run automatically as a `Stop` hook) commits them, pushes a branch, and opens
or updates a GitHub pull request — and, once there's a real link, forces you
to say so clearly in the chat. **All of that is guaranteed to happen whether
or not you follow this skill** — it's a plain script, not something you need
to remember to trigger, and it doesn't need this skill's Part B below to
make sure the person sees the link.

What the script can't do on its own is judge whether new work belongs on
the PR that's already open, or deserves its own — and it can't explain
*why* something changed in language a reviewer who didn't watch you work
can follow. Both of those are yours.

## Part A — before you start a new chunk of work

By default, review-gate keeps you on the same branch (and therefore the
same PR) for as long as your current Claude Code session runs. That's
correct for a single task split across a few turns, but wrong once you
move on to a second, *independent* piece of work in the same long-running
session — without you doing anything, it would just keep stacking
unrelated commits onto whatever PR is already open, which defeats the
point of one-reviewable-change-per-PR.

Before touching any files for what might be a new feature or phase (not a
follow-up fix, typo correction, or "also handle this edge case" for what
you just did — those belong on the PR that's already open):

1. Check whether a PR is already open for the current branch:
   `gh pr view --json number,url,title --jq '"\(.number) \(.title) \(.url)"'`.
2. If nothing's open, or what you're about to do is clearly a continuation
   of that same PR's work, just proceed normally — no need to ask.
3. If a PR **is** open and this next piece of work reads as genuinely
   separate, ask the person before making any edits — don't guess either
   way:
   > There's an open PR (#\<N\>, "\<title\>") waiting for review. Want me to
   > (a) keep adding this to that same PR, (b) start a fresh PR so #\<N\>
   > stays reviewable on its own, or (c) hold off until you've
   > reviewed/merged #\<N\> first?
4. Act on their answer:
   - **(a)**, or they say it's related: proceed normally, nothing to do.
   - **(c)**: don't edit anything yet. Wait for them to say they've
     reviewed or merged it, then re-check step 1.
   - **(b)**: run `/new-pr` yourself (or follow `commands/new-pr.md`'s
     steps directly) before making any edits. It refuses if anything's
     still uncommitted — let review-gate commit that first — then creates
     a fresh branch and makes sure review-gate's own session tracking
     points at it, so the Stop hook doesn't switch you back to the old
     branch and commit the new feature there by mistake. Tell the person
     the old PR's link (so they know where to find it) and that a new one
     will open once this work is committed.

## Part B — when you're done with a chunk of work

0. **Timing matters.** The Stop hook only runs after your turn fully ends —
   it cannot have committed anything yet while you're still mid-response. If
   you're following this skill in the *same* turn where you just made edits,
   checking the PR right now would see stale data from before this edit and
   likely confuse you into thinking something's broken or into committing by
   hand (don't — that defeats the whole point of this tool). Instead, force
   review-gate to run synchronously first: find the project root (nearest
   `.git` folder), then find `review-gate.js` — it's at
   `${CLAUDE_PLUGIN_ROOT}/scripts/review-gate.js` if that environment
   variable is set (a real plugin install), otherwise at
   `<project root>/.claude/scripts/review-gate.js` (the manual copy-files
   install) — check which one actually exists rather than assuming, then
   run it with
   `node <that path>` piping in
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
   own clearly labeled block, not folded into other prose. review-gate's
   hook will force this at minimum on its own even if you skip this whole
   skill (it doesn't include the "why" though — that part really is yours):

   ```
   Summary: <one or two plain-language sentences — what changed and why>
   PR link: <the PR URL>
   ```

Do not merge the PR yourself, and don't push directly to the base branch
(main/master) to "save a step" — the entire point of this tool is that a
human reviews and merges the change.
