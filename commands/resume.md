---
description: Turn review-gate back on for this project after /pause.
---

1. Find the project root (the nearest directory containing a `.git` folder).
2. Read `.claude/review-gate.json` there if it exists (treat a missing or
   unreadable file as `{}`).
3. Remove its `enabled` key entirely (rather than setting it to `true`) —
   `enabled` defaults to on, so deleting the key is equivalent and keeps the
   file from claiming a setting the person never actually chose. Leave
   every other key untouched.
4. If the file is now empty (`{}`), delete `.claude/review-gate.json`
   entirely instead of writing an empty file. Otherwise write the trimmed
   config back.
5. Tell the person review-gate is active again for this project: future
   turns with uncommitted changes will go back to being auto-committed,
   pushed, and opened as pull requests.
