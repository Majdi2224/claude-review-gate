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
5. Tell the person in the chat that the PR is ready for review and give them
   the link, even though review-gate already printed a note about it — they
   may not have seen it.

Do not merge the PR yourself, and don't push directly to the base branch
(main/master) to "save a step" — the entire point of this tool is that a
human reviews and merges the change.
