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
   bare repo as `origin`, no network needed) plus a mocked `gh`/`claude`. On
   Windows those mocks are a tiny C# trampoline compiled with `csc.exe`
   (already on any Windows box with .NET Framework), because Node's
   `execFileSync` — deliberately used without `shell: true` in
   `review-gate.js` — can't launch `.cmd`/`.bat` fakes directly; those tests
   skip themselves if `csc.exe` isn't found. 22 tests passing as of the last
   update here.

3. ~~**Optional AI-written summaries.**~~ Done — `aiSummary` (on by
   default) shells out to `claude -p ... --safe-mode --restricted` with the
   diff piped in. Verified for real (not just mocked) against a live GitHub
   repo: the opened PR's body was genuinely Claude-written, not the
   mechanical fallback.

4. ~~**Security hardening pass.**~~ Done, prompted by an explicit ask to
   make this "as secure as possible before anyone else installs it":
   - `blockSecretFiles` (on by default): before ever touching git, scans
     for common credential filenames (`.env`, `id_rsa`, `*.pem`,
     `credentials.json`, ...) and, separately, added diff lines for
     well-known live API key/token formats (AWS, GitHub, GitLab, Anthropic,
     OpenAI, Slack, Stripe, Google, PEM key blocks). Either check tripping
     means nothing is committed or pushed at all. Verified live: a real
     `.env` and a real hardcoded token were both held back with zero git
     state changed.
   - The `aiSummary` call also passes `--disallowedTools
     Edit,Write,MultiEdit,NotebookEdit --permission-prompts none`, on top of
     `--restricted` — `--restricted` alone still leaves file tools available
     (just confined to the working directory, which is the real repo), so a
     prompt-injected instruction hidden in the diff being summarized could
     otherwise get that "just describe this" call to actually edit files.
   - Every git/gh subprocess call has a timeout (60s — see below for why),
     so a hung network call can't block the Stop hook indefinitely.
   - Known, documented (not fixed — would need a bigger redesign):
     `.claude/review-gate.json` lives inside the repo it's protecting, so a
     merged PR could turn `blockSecretFiles` back off for later runs.
     review-gate assumes a trusted repo/committer, not a malicious
     collaborator.

5. ~~**`/review-gate:pause` and `/review-gate:resume` commands.**~~ Done —
   `/pause` sets `enabled: false` while preserving any other config keys;
   `/resume` removes the key again (deleting the file entirely if that was
   its only key).

6. ~~**Handle a diverged/conflicted branch gracefully.**~~ Done — a
   rejected push now checks whether the remote branch already exists; if
   so, that's the signature of a real divergence, and the note says so
   explicitly and tells the person to `git pull --rebase` themselves.
   review-gate deliberately never merges/rebases/force-pushes on its own —
   silently rewriting history is a worse failure mode than a clear note.
   (Along the way: live testing found the original 20s subprocess timeout
   was too aggressive — a real `gh auth status` call was observed timing
   out against the Windows credential manager well past 20s on a real
   machine, which would have made review-gate falsely report a working
   push as failed. Bumped to 60s.)

7. **GitLab (`glab`) / Bitbucket support**, behind a config option, so this
   isn't GitHub-only. Not started — worth confirming this is actually
   needed before investing in it, since every real test so far (and the
   marketplace listing) has been GitHub-specific. `glab`'s CLI is close
   enough to `gh`'s that supporting it is tractable; Bitbucket has no
   comparable first-party CLI, so that would mean raw REST calls and its
   own auth/token handling — a meaningfully bigger scope than "add a
   second CLI branch."

8. ~~**Reviewers/labels from config.**~~ Done — `.claude/review-gate.json`
   can set `reviewers`/`labels`, applied via `gh pr edit` after the PR
   exists (not inline on `gh pr create`) so a typo'd name never costs the
   PR itself.

8a. ~~**Gate PR creation on tests passing.**~~ Done — `testResultsFile`
   (off by default) points review-gate at a path a separate Stop hook
   writes `{"passed": true|false}` to. Registering that hook before
   review-gate in the `Stop` array guarantees the result is fresh for the
   exact turn (Claude Code runs same-event hooks in list order). A `false`
   result opens the PR as a **draft** instead of skipping it entirely;
   missing/unreadable/unconfigured is treated as unknown and never blocks
   a normal PR.

9. **Publish properly**: real repo description, a couple of screenshots of
   an opened PR, and an actual marketplace listing once this has been used
   on a handful of real projects — don't publish it as "no issues,
   production-ready" until it's actually been through that.
