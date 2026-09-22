const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { installFakeBin, newCliScenario } = require("./helpers/fake-cli-setup");

const SCRIPT = path.join(__dirname, "..", "scripts", "review-gate.js");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// Makes a repo with an initial commit on `main`, plus a local bare repo
// (no network needed) that acts as `origin` unless `withOrigin: false`.
function makeRepo({ withOrigin = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-repo-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "initial"]);
  git(dir, ["branch", "-M", "main"]);

  let bareDir = null;
  if (withOrigin) {
    bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-bare-"));
    git(bareDir, ["init", "-q", "--bare"]);
    git(dir, ["remote", "add", "origin", bareDir]);
  }
  return { dir, bareDir };
}

function writeConfig(dir, config) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "review-gate.json"),
    JSON.stringify(config)
  );
}

function pathWithoutRealTool(basePath, toolName) {
  const exeName = process.platform === "win32" ? toolName + ".exe" : toolName;
  return basePath
    .split(path.delimiter)
    .filter((entry) => !fs.existsSync(path.join(entry, exeName)))
    .join(path.delimiter);
}

function runReviewGate(
  cwd,
  { sessionId = "test-session", fakeBinDir, hideRealGh, extraEnv = {} } = {}
) {
  const env = { ...process.env, ...extraEnv };
  env.PATH = hideRealGh ? pathWithoutRealTool(env.PATH, "gh") : env.PATH;
  if (fakeBinDir) env.PATH = fakeBinDir + path.delimiter + env.PATH;

  return execFileSync("node", [SCRIPT], {
    cwd,
    input: JSON.stringify({ cwd, session_id: sessionId }),
    encoding: "utf8",
    env,
  });
}

let fakeBinDir;
before(() => {
  fakeBinDir = installFakeBin(["gh", "claude"]);
  if (!fakeBinDir) {
    console.log(
      "[skip] no C# compiler (csc.exe) found — gh/claude-dependent tests will be skipped on this machine"
    );
  }
});

test("no git repo: does nothing, no output", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-norepo-"));
  const out = runReviewGate(dir, { hideRealGh: true });
  assert.equal(out, "");
});

test("no uncommitted changes: does nothing, no output", () => {
  const { dir } = makeRepo();
  const out = runReviewGate(dir, { hideRealGh: true });
  assert.equal(out, "");
});

test("changes on main: auto-creates a branch and commits, off main", () => {
  const { dir, bareDir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");

  runReviewGate(dir, { hideRealGh: true });

  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert.match(branch, /^claude\//);
  assert.equal(git(dir, ["status", "--porcelain"]), "");

  const branchesOnOrigin = git(bareDir, ["branch", "--list"]);
  assert.match(branchesOnOrigin, new RegExp(branch));
});

test("changes on a feature branch: reused as-is, not renamed", () => {
  const { dir } = makeRepo();
  git(dir, ["checkout", "-q", "-b", "my-feature"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");

  runReviewGate(dir, { hideRealGh: true });

  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "my-feature");
});

test("no origin remote: commits locally, nothing pushed", () => {
  const { dir } = makeRepo({ withOrigin: false });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.match(out, /no "origin" remote/);
  assert.equal(git(dir, ["log", "-1", "--pretty=%s"]), "Claude Code: update README.md");
});

test("no gh installed: pushes, notes gh is missing", () => {
  const { dir, bareDir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.match(out, /Install the GitHub CLI/);
  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  assert.match(git(bareDir, ["branch", "--list"]), new RegExp(branch));
});

test("gh not authenticated: pushes, does not attempt a PR", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 1 },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(out, /isn't logged in/);
  assert.deepEqual(
    scenario.invocations().map((a) => a[1]),
    ["--version", "auth"]
  );
});

test("PR already exists: updates it, does not create a new one, never asks Claude for a summary", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": {
        stdout: "https://github.com/example/repo/pull/1\n",
      },
      "pr create **": { stdout: "https://github.com/example/repo/pull/999\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(out, /updated the existing PR — https:\/\/github\.com\/example\/repo\/pull\/1/);
  const calls = scenario.invocations();
  assert.ok(!calls.some((a) => a[0] === "gh" && a[2] === "create"), "should not have called `gh pr create`");
  assert.ok(!calls.some((a) => a[0] === "claude"), "should not have asked Claude for a summary");
});

test("no PR yet, AI summary off: opens one with the mechanical body", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/2\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(out, /opened a PR for review — https:\/\/github\.com\/example\/repo\/pull\/2/);
  const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const calls = scenario.invocations();
  assert.ok(!calls.some((a) => a[0] === "claude"), "aiSummary: false should skip Claude entirely");
  const createCall = calls.find((a) => a[0] === "gh" && a[2] === "create");
  assert.ok(createCall, "expected a `gh pr create` call");
  assert.equal(createCall[createCall.indexOf("--base") + 1], "main");
  assert.equal(createCall[createCall.indexOf("--head") + 1], branch);
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /generated mechanically/);
});

test("no PR yet, AI summary on (default): PR body is Claude's summary", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/3\n" },
    },
    claude: {
      "-p * --output-format text --model haiku --safe-mode --restricted": {
        stdout: "Updates the README with an extra line.\n",
      },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(out, /opened a PR for review — https:\/\/github\.com\/example\/repo\/pull\/3/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /Updates the README with an extra line\./);
  assert.doesNotMatch(body, /generated mechanically/);
});

test("no PR yet, Claude call fails: falls back to the mechanical body", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/4\n" },
    },
    claude: {
      "-p * --output-format text --model haiku --safe-mode --restricted": { code: 1 },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(out, /opened a PR for review/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /generated mechanically/);
});
