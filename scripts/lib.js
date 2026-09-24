// Shared helpers between review-gate.js (the Stop hook) and any other
// script that needs to read its config or touch its session-branch state
// (e.g. start-new-pr.js). Keeping these in one place means the git-dir /
// state-file resolution logic can't drift out of sync between scripts.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Generous on purpose: a real git push or `gh` call can go through an OS
// credential manager (Windows' keyring lookup in particular has been
// observed taking well over 20s on a real machine) before it ever touches
// the network. This needs to be long enough that a legitimately slow-but-
// working environment isn't mistaken for a hang and reported as a failure
// — an actual hang still eventually gets killed, just later.
const CMD_TIMEOUT_MS = 60000;

function run(cwd, cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CMD_TIMEOUT_MS,
    }).trim();
  } catch {
    return null;
  }
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {
    /* best-effort only */
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

const DEFAULT_CONFIG = {
  enabled: true,
  baseBranches: ["main", "master"],
  branchPrefix: "claude/",
  aiSummary: true,
  blockSecretFiles: true,
  reviewers: [],
  labels: [],
  testResultsFile: null,
  announceInChat: true,
};

function loadConfig(cwd) {
  return loadJson(path.join(cwd, ".claude", "review-gate.json"), DEFAULT_CONFIG);
}

// Resolves the path to review-gate's own session-branch state file:
// <git-dir>/review-gate/sessions.json. Lives inside .git/ on purpose —
// local-only, never accidentally committed.
function stateFilePath(cwd) {
  let gitDir = run(cwd, "git", ["rev-parse", "--git-dir"]) || ".git";
  if (!path.isAbsolute(gitDir)) gitDir = path.join(cwd, gitDir);
  return path.join(gitDir, "review-gate", "sessions.json");
}

module.exports = {
  CMD_TIMEOUT_MS,
  run,
  loadJson,
  saveJson,
  timestamp,
  DEFAULT_CONFIG,
  loadConfig,
  stateFilePath,
};
