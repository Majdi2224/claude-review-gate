# review-gate

A Claude Code plugin that turns Claude's file edits into a reviewable GitHub
pull request, instead of leaving changes applied silently in your working
copy.

## Why

Claude Code (and AI coding tools generally) can edit files directly on disk.
That's great for speed, bad for anyone — especially a non-expert dev — who
doesn't reflexively read every diff before it's effectively "live" in their
project. review-gate makes reviewing the default path: it never blocks
Claude from working, it just makes sure every change also lands somewhere a
human has to look at before it's merged.

## What it actually does

1. A `Stop` hook (`scripts/review-gate.js`) runs after every turn Claude
   Code finishes.
2. If there are no uncommitted changes, it does nothing — silent, no
   overhead.
3. If there are, it:
   - makes sure the changes are on a feature branch, not `main`/`master`
     (creating one automatically if needed),
   - commits them with a mechanically generated message,
   - pushes the branch to `origin`,
   - opens a GitHub pull request via the `gh` CLI (or updates the existing
     one, since pushing new commits does that automatically).
4. A skill (`skills/review-gate/SKILL.md`) nudges Claude to replace the
   mechanical PR description with a short, honest, plain-language summary
   once it's actually done with a task.
5. A `/ship` command lets you (or Claude) force step 3 to happen mid-session
   instead of waiting for the turn to end.

The commit/push/PR-open step is a deterministic script, not something the
model decides to do — that's on purpose. Relying on the model to "remember"
every time is exactly the kind of gap this tool exists to close. The skill
is a quality layer on top of that guarantee, not a substitute for it.

## Requirements

- Node.js (already required to run Claude Code itself, so this doesn't add
  a new dependency).
- `git`, with the project already a git repository (`git init`) and an
  `origin` remote pointing at a GitHub repo.
- [GitHub CLI](https://cli.github.com/) (`gh`), installed and logged in
  (`gh auth login`).

Missing any of these isn't a hard failure — the hook checks for each one and
prints a plain-language note about what's missing and what still happened
(e.g. "committed locally, but nothing was pushed because there's no
`origin` remote yet").

## Configuration

Drop a `.claude/review-gate.json` file in a project to override the
defaults:

```json
{
  "enabled": true,
  "baseBranches": ["main", "master"],
  "branchPrefix": "claude/",
  "aiSummary": true
}
```

- `enabled: false` turns review-gate off for that project entirely.
- `baseBranches` — branches review-gate treats as protected. If Claude
  leaves changes sitting directly on one of these, review-gate moves them to
  a new branch instead of committing straight to it. The first entry is
  also used as the PR's base branch.
- `branchPrefix` — prefix used for auto-created branch names
  (`claude/20260922-143011`, for example).
- `aiSummary` — when a *new* PR is opened (not on later pushes to an
  existing one), review-gate shells out to `claude -p` (headless, with
  `--safe-mode` so it can't trigger hooks — including itself — recursively,
  and `--restricted` so it has no tool access) to write the PR description
  from the actual diff, instead of the mechanical `git diff --stat` + commit
  log. This is on by default; set it to `false` to skip it and keep the
  mechanical body. If the call fails, times out, or `claude` isn't on
  `PATH`, review-gate silently falls back to the mechanical body — it never
  blocks a PR from opening over this.

## Installing it

**For this one project**, the fastest way to try it without dealing with
the plugin/marketplace system at all:

1. Copy `scripts/review-gate.js`, `skills/review-gate/`, and
   `commands/ship.md` into that project's `.claude/` folder (so you end up
   with `.claude/scripts/review-gate.js`, `.claude/skills/review-gate/`, and
   `.claude/commands/ship.md`).
2. Add the `hooks` key below to that project's `.claude/settings.json` —
   note this uses `${CLAUDE_PROJECT_DIR}`, not `${CLAUDE_PLUGIN_ROOT}`
   (that variable only resolves for real plugin installs, not a plain copied
   hook):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/scripts/review-gate.js\""
          }
        ]
      }
    ]
  }
}
```

That uses Claude Code's plain project-level hooks/skills/commands — no
plugin installation involved.

**As an installable plugin**, once this folder is pushed to a public GitHub
repo:

```
/plugin marketplace add YOUR-GITHUB-USERNAME/claude-review-gate
/plugin install review-gate@majdi-claude-plugins
```

(the marketplace name comes from `.claude-plugin/marketplace.json`). Anyone
who runs those two commands in Claude Code gets review-gate in that project.

Claude Code's plugin file layout has moved before and may move again —
if a fresh Claude Code version doesn't pick this structure up, check
Claude Code's current plugin documentation for what changed, and fall back
to the "for this one project" method above in the meantime.

## Limitations (be honest about these)

- GitHub only, via `gh`. No GitLab/Bitbucket support yet.
- By default the PR description is written by a separate, tool-less
  `claude -p` call reading the diff (see `aiSummary` above), which falls
  back to a mechanical `git diff --stat` + commit log if that call fails or
  is turned off. Either way, it's generated once, when the PR is opened —
  it won't reflect later pushes to the same PR. The `review-gate` skill is
  what refines it further, and that only happens when the session's own
  Claude follows the skill.
- It does not scan for vulnerabilities, run a linter, or otherwise judge
  whether the change is *good* — it only guarantees the change is visible
  and reviewable before it can be merged. Don't market it as a security
  tool; it's a review-visibility tool.
- One PR per branch/session, kept updated by new commits — it will not spam
  a new PR every single turn.

See `NEXT_STEPS.md` for ideas on where to take this next.

## License

MIT — see `LICENSE`.
