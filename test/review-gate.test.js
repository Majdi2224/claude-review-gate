const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { installFakeBin, newCliScenario } = require("./helpers/fake-cli-setup");
const { git, makeRepo, writeConfig } = require("./helpers/repo");

const SCRIPT = path.join(__dirname, "..", "scripts", "review-gate.js");

function pathWithoutRealTool(basePath, toolName) {
  const exeName = process.platform === "win32" ? toolName + ".exe" : toolName;
  return basePath
    .split(path.delimiter)
    .filter((entry) => !fs.existsSync(path.join(entry, exeName)))
    .join(path.delimiter);
}

function runReviewGate(
  cwd,
  { sessionId = "test-session", fakeBinDir, hideRealGh, extraEnv = {}, stopHookActive = false } = {}
) {
  const env = { ...process.env, ...extraEnv };
  env.PATH = hideRealGh ? pathWithoutRealTool(env.PATH, "gh") : env.PATH;
  if (fakeBinDir) env.PATH = fakeBinDir + path.delimiter + env.PATH;

  return execFileSync("node", [SCRIPT], {
    cwd,
    input: JSON.stringify({ cwd, session_id: sessionId, stop_hook_active: stopHookActive }),
    encoding: "utf8",
    env,
  });
}

// Success paths force a {"decision":"block","reason":"..."} continuation by
// default so the PR link can never be silently missing from the chat (see
// announcePr() in review-gate.js). Parses that out for assertions.
function parseBlock(out) {
  const parsed = JSON.parse(out);
  assert.equal(parsed.decision, "block");
  return parsed.reason;
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

test("a forgotten .env file: held back entirely, nothing committed or pushed", () => {
  const { dir, bareDir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  fs.writeFileSync(path.join(dir, ".env"), "API_KEY=super-secret\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.match(out, /held back/);
  assert.match(out, /\.env/);
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  assert.notEqual(git(dir, ["status", "--porcelain"]), "");
  assert.equal(git(bareDir, ["branch", "--list"]), "");
});

test(".env.example is not treated as a secret", () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, ".env.example"), "API_KEY=\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.doesNotMatch(out, /held back/);
  assert.match(git(dir, ["log", "-1", "--pretty=%s"]), /update \.env\.example/);
});

test("a hardcoded API key inline in a normal file: held back, unstaged", () => {
  const { dir, bareDir } = makeRepo();
  fs.writeFileSync(
    path.join(dir, "config.js"),
    'module.exports = { token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" };\n'
  );

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.match(out, /held back/);
  assert.match(out, /API key\/token\/private key/);
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  assert.notEqual(git(dir, ["status", "--porcelain"]), "");
  assert.equal(git(dir, ["diff", "--cached"]), ""); // unstaged, not left half-committed
  assert.equal(git(bareDir, ["branch", "--list"]), "");
});

test("removing an old key is not blocked", () => {
  const { dir } = makeRepo();
  fs.writeFileSync(
    path.join(dir, "config.js"),
    'module.exports = { token: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" };\n'
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "add token"]);
  fs.writeFileSync(path.join(dir, "config.js"), "module.exports = {};\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.doesNotMatch(out, /held back/);
  assert.equal(git(dir, ["status", "--porcelain"]), "");
});

test("blockSecretFiles: false opts back into committing an .env file", () => {
  const { dir } = makeRepo();
  writeConfig(dir, { blockSecretFiles: false });
  fs.writeFileSync(path.join(dir, ".env"), "API_KEY=super-secret\n");

  const out = runReviewGate(dir, { hideRealGh: true });

  assert.doesNotMatch(out, /held back/);
  assert.equal(git(dir, ["status", "--porcelain"]), "");
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

test("push rejected because the branch diverged from origin: says so, doesn't try to fix it", () => {
  const { dir, bareDir } = makeRepo();
  git(dir, ["checkout", "-q", "-b", "feature-x"]);
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nfirst\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "first"]);
  git(dir, ["push", "-q", "-u", "origin", "feature-x"]);

  // Someone else pushes a second commit to the same branch on origin.
  const otherClone = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-other-"));
  git(otherClone, ["clone", "-q", bareDir, "."]);
  git(otherClone, ["checkout", "-q", "feature-x"]);
  fs.writeFileSync(path.join(otherClone, "OTHER.md"), "from someone else\n");
  git(otherClone, ["add", "-A"]);
  git(otherClone, ["commit", "-q", "-m", "external commit"]);
  git(otherClone, ["push", "-q"]);

  // Our local clone still only knows about "first" and now makes its own
  // commit on top of it, which origin can no longer fast-forward to.
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nfirst\nedited\n");
  const out = runReviewGate(dir, { hideRealGh: true });

  assert.match(out, /diverged/);
  assert.match(out, /won't merge, rebase, or force-push/);
  assert.equal(git(dir, ["status", "--porcelain"]), ""); // committed locally either way
  assert.equal(git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), "feature-x");
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

  const reason1 = parseBlock(out);
  assert.match(reason1, /updated the existing PR/);
  assert.match(reason1, /PR link: https:\/\/github\.com\/example\/repo\/pull\/1/);
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

  const reason2 = parseBlock(out);
  assert.match(reason2, /opened a PR for review/);
  assert.match(reason2, /PR link: https:\/\/github\.com\/example\/repo\/pull\/2/);
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
      "-p * --output-format text --model haiku --safe-mode --restricted --disallowedTools Edit,Write,MultiEdit,NotebookEdit --permission-prompts none": {
        stdout: "Updates the README with an extra line.\n",
      },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason3 = parseBlock(out);
  assert.match(reason3, /opened a PR for review/);
  assert.match(reason3, /PR link: https:\/\/github\.com\/example\/repo\/pull\/3/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /Updates the README with an extra line\./);
  assert.doesNotMatch(body, /generated mechanically/);

  // The summary call must not be able to touch files in the real repo,
  // even if the (untrusted) diff it's fed tries to prompt-inject it.
  const claudeCall = scenario.invocations().find((a) => a[0] === "claude");
  assert.ok(claudeCall.includes("--disallowedTools"));
  assert.equal(claudeCall[claudeCall.indexOf("--disallowedTools") + 1], "Edit,Write,MultiEdit,NotebookEdit");
  assert.equal(claudeCall[claudeCall.indexOf("--permission-prompts") + 1], "none");
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
      "-p * --output-format text --model haiku --safe-mode --restricted --disallowedTools Edit,Write,MultiEdit,NotebookEdit --permission-prompts none": { code: 1 },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.match(parseBlock(out), /opened a PR for review/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /generated mechanically/);
});

test("reviewers/labels from config are attached to a newly opened PR", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, {
    aiSummary: false,
    reviewers: ["alice", "bob"],
    labels: ["ai-generated"],
  });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/5\n" },
      "pr edit * --add-reviewer alice,bob": { code: 0 },
      "pr edit * --add-label ai-generated": { code: 0 },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason5 = parseBlock(out);
  assert.match(reason5, /opened a PR for review/);
  assert.match(reason5, /PR link: https:\/\/github\.com\/example\/repo\/pull\/5/);
  const calls = scenario.invocations();
  assert.ok(calls.some((a) => a[0] === "gh" && a.includes("--add-reviewer") && a.includes("alice,bob")));
  assert.ok(calls.some((a) => a[0] === "gh" && a.includes("--add-label") && a.includes("ai-generated")));
});

test("an invalid reviewer/label doesn't cost you the PR", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false, reviewers: ["no-such-user"] });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/6\n" },
      // "pr edit ... --add-reviewer no-such-user" is deliberately left
      // unmocked, so the fake CLI exits 1 for it, same as a real invalid
      // reviewer would.
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason6 = parseBlock(out);
  assert.match(reason6, /opened a PR for review/);
  assert.match(reason6, /PR link: https:\/\/github\.com\/example\/repo\/pull\/6/);
});

test("failing tests (from a separate test-runner hook's result file): PR opens as a draft", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false, testResultsFile: ".claude/test-results.json" });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "test-results.json"), JSON.stringify({ passed: false }));
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/7\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason7 = parseBlock(out);
  assert.match(reason7, /opened as a draft \(tests were failing/);
  assert.match(reason7, /PR link: https:\/\/github\.com\/example\/repo\/pull\/7/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  assert.ok(createCall.includes("--draft"));
  const body = createCall[createCall.indexOf("--body") + 1];
  assert.match(body, /Tests were failing/);
});

test("passing tests (from the result file): normal PR, not a draft", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false, testResultsFile: ".claude/test-results.json" });
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "test-results.json"), JSON.stringify({ passed: true }));
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/8\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason8 = parseBlock(out);
  assert.match(reason8, /opened a PR for review/);
  assert.match(reason8, /PR link: https:\/\/github\.com\/example\/repo\/pull\/8/);
  const createCall = scenario.invocations().find((a) => a[0] === "gh" && a[2] === "create");
  assert.ok(!createCall.includes("--draft"));
});

test("testResultsFile configured but missing: never blocks a normal PR", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false, testResultsFile: ".claude/test-results.json" });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/9\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason9 = parseBlock(out);
  assert.match(reason9, /opened a PR for review/);
  assert.match(reason9, /PR link: https:\/\/github\.com\/example\/repo\/pull\/9/);
});

test("announceInChat: false opts back into the plain note instead of blocking", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false, announceInChat: false });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/10\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  assert.doesNotMatch(out, /"decision"/);
  assert.match(out, /\[review-gate\] opened a PR for review — https:\/\/github\.com\/example\/repo\/pull\/10/);
});

test("stop_hook_active: true never blocks twice in the same cycle", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  writeConfig(dir, { aiSummary: false });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": { code: 1 },
      "pr create **": { stdout: "https://github.com/example/repo/pull/11\n" },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env, stopHookActive: true });

  assert.doesNotMatch(out, /"decision"/);
  assert.match(out, /\[review-gate\] opened a PR for review — https:\/\/github\.com\/example\/repo\/pull\/11/);
});

test("updating an existing PR also forces the announcement by default", { skip: !fakeBinDir }, () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "README.md"), "hello\nedited\n");
  const scenario = newCliScenario({
    gh: {
      "--version": { stdout: "gh version 2.0.0\n" },
      "auth status": { code: 0 },
      "pr view * --json url --jq .url": {
        stdout: "https://github.com/example/repo/pull/12\n",
      },
    },
  });

  const out = runReviewGate(dir, { fakeBinDir, extraEnv: scenario.env });

  const reason = parseBlock(out);
  assert.match(reason, /updated the existing PR/);
  assert.match(reason, /PR link: https:\/\/github\.com\/example\/repo\/pull\/12/);
});
