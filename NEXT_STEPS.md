# Where to take this next

v0.1 (what's in this folder) is deliberately narrow: GitHub only, mechanical
PR descriptions, no tests. In rough priority order:

1. ~~**Verify the hook actually fires and works end to end.**~~ Done —
   verified against a real nested Claude Code session in a throwaway GitHub
   repo: the Stop hook fired, committed, pushed, opened a PR, then correctly
   updated (not duplicated) that PR on a second edit. Along the way this
   found and fixed a real bug: the README's "for this one project" install
   instructions used `${CLAUDE_PLUGIN_ROOT}` (plugin-only) instead of
   `${CLAUDE_PROJECT_DIR}`, and never told you to copy `scripts/review-gate.js`
   into the project at all — copying `hooks/hooks.json` verbatim as instructed
   would fail with `Cannot find module`. See the corrected steps in README.md.

2. ~~**Automated tests for `scripts/review-gate.js`.**~~ Done — see
   `test/review-gate.test.js` (run with `npm test`). Uses real `git` (a local
   bare repo as `origin`, no network needed) plus a mocked `gh`, and covers:
   no repo, no changes, changes on main → branch created, changes on a
   feature branch → reused, no origin remote, no `gh` installed, `gh` not
   authenticated, PR already exists, and opening a new PR. On Windows the
   `gh` mock is a tiny C# trampoline compiled with `csc.exe` (already on any
   Windows box with .NET Framework), because Node's `execFileSync` —
   deliberately used without `shell: true` in `review-gate.js` — can't launch
   `.cmd`/`.bat` fakes directly; those gh-dependent tests skip themselves if
   `csc.exe` isn't found.

3. **Optional AI-written summaries.** Right now the auto-generated PR body
   is just `git diff --stat` + commit log — mechanical, on purpose, for
   v0.1. A v2 could shell out to `claude -p "<prompt>" --output-format text`
   with the diff piped in, to get a real natural-language summary as part
   of the hook itself (not dependent on the current session's model
   remembering to run the `review-gate` skill). Watch for: cost per PR,
   latency added to every Stop event, and never let this call trigger
   Claude Code's own hooks recursively.

4. **Gate PR creation on tests passing.** Majdi already has a Stop hook
   that runs tests. Worth wiring review-gate to only open (not just commit)
   the PR if that hook's last run passed, and otherwise note "tests are
   failing, opening as a draft" — needs a way for one hook to read another
   hook's last result.

5. **`/review-gate:pause` and `/review-gate:resume` commands** instead of
   requiring someone to hand-edit `.claude/review-gate.json`.

6. **Handle a diverged/conflicted branch gracefully** instead of the push
   silently failing — right now that just prints a note telling the person
   to push manually, which is a reasonable fallback but not a great one.

7. **GitLab (`glab`) / Bitbucket support**, behind a config option, so this
   isn't GitHub-only.

8. **Reviewers/labels.** Let `.claude/review-gate.json` specify
   `reviewers: ["someone"]` / `labels: ["ai-generated"]` and pass them to
   `gh pr create`.

9. **Publish properly**: real repo description, a couple of screenshots of
   an opened PR, and an actual marketplace listing once this has been used
   on a handful of real projects — don't publish it as "no issues,
   production-ready" until it's actually been through that.
