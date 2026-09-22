---
description: Turn review-gate off for this project until /resume.
---

1. Find the project root (the nearest directory containing a `.git` folder).
2. Read `.claude/review-gate.json` there if it exists (treat a missing or
   unreadable file as `{}`).
3. Set its `enabled` key to `false`, keeping every other key in the file
   exactly as it was — this must never clobber `baseBranches`,
   `branchPrefix`, `aiSummary`, or `blockSecretFiles` if the person already
   configured them.
4. Write the file back (create `.claude/` first if it doesn't exist yet),
   formatted as readable JSON.
5. Tell the person review-gate is paused for this project: their edits will
   no longer be auto-committed, pushed, or opened as pull requests until
   they run `/resume`. Uncommitted changes already sitting in the working
   tree are untouched — this only affects future turns.
