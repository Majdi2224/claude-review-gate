const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { git, makeRepo } = require("./helpers/repo");

const SCRIPT = path.join(__dirname, "..", "scripts", "start-new-pr.js");

function runStartNewPr(cwd, args = []) {
  return execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

function parseOutput(out) {
  const lines = Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((line) => line.split("="))
      .map(([k, ...rest]) => [k, rest.join("=")])
  );
  return lines;
}

test("refuses with uncommitted changes, exits non-zero", () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");

  assert.throws(
    () => runStartNewPr(dir),
    (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stderr.toString(), /uncommitted changes/);
      return true;
    }
  );
  // Refused before touching anything — still on main, nothing staged.
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
});

test("creates a new branch off the base branch", () => {
  const { dir } = makeRepo();
  git(dir, ["checkout", "-q", "-b", "claude/old-feature-20260101-000000"]);

  const out = parseOutput(runStartNewPr(dir, ["auth"]));

  assert.equal(out.OLD_BRANCH, "claude/old-feature-20260101-000000");
  assert.equal(out.BASE_BRANCH, "main");
  assert.match(out.NEW_BRANCH, /^claude\/auth-\d{8}-\d{6}$/);
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), out.NEW_BRANCH);
});

test("slug is sanitized to a safe branch-name fragment", () => {
  const { dir } = makeRepo();

  const out = parseOutput(runStartNewPr(dir, ["Auth Feature!! v2"]));

  assert.match(out.NEW_BRANCH, /^claude\/auth-feature-v2-\d{8}-\d{6}$/);
});

test("no slug given: falls back to a plain timestamped branch", () => {
  const { dir } = makeRepo();

  const out = parseOutput(runStartNewPr(dir));

  assert.match(out.NEW_BRANCH, /^claude\/\d{8}-\d{6}$/);
});

test("re-points any session recorded against the old branch to the new one", () => {
  const { dir } = makeRepo();
  git(dir, ["checkout", "-q", "-b", "claude/old-20260101-000000"]);

  const gitDir = path.join(dir, ".git");
  const stateFile = path.join(gitDir, "review-gate", "sessions.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      "session-on-old-branch": "claude/old-20260101-000000",
      "session-on-other-branch": "claude/unrelated-branch",
    })
  );

  const out = parseOutput(runStartNewPr(dir));
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));

  assert.equal(state["session-on-old-branch"], out.NEW_BRANCH);
  // A session pointed at some other, unrelated branch must be left alone.
  assert.equal(state["session-on-other-branch"], "claude/unrelated-branch");
});

test("no session state file yet: still works, creates nothing spurious", () => {
  const { dir } = makeRepo();

  const out = parseOutput(runStartNewPr(dir, ["first-feature"]));

  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), out.NEW_BRANCH);
  const stateFile = path.join(dir, ".git", "review-gate", "sessions.json");
  assert.equal(fs.existsSync(stateFile), false);
});
