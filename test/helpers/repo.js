// Shared test-repo helpers used by both review-gate.test.js and
// start-new-pr.test.js, so the git-plumbing setup can't drift between them.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

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

module.exports = { git, makeRepo, writeConfig };
