#!/usr/bin/env node
/**
 * start-new-pr — manually starts a fresh branch/PR for a new feature or
 * phase, without waiting for a new Claude Code session.
 *
 * Unlike review-gate.js (a Stop hook that must never fail loudly), this is
 * only ever run on purpose — by the review-gate skill, when it and the
 * person have agreed a new PR is actually warranted, or directly via
 * `/review-gate:new-pr`. So it's fine, and correct, for this one to print
 * a clear error and exit non-zero when something's wrong.
 *
 * What it does:
 *   1. Refuses if there are uncommitted changes (they'd silently follow
 *      the branch switch — see the check-and-explain below).
 *   2. Checks out the configured base branch, then creates+checks out a
 *      new branch off it.
 *   3. Re-points review-gate's own session-state file: any session
 *      currently recorded against the old branch now points at the new
 *      one, so the Stop hook doesn't switch back to the old branch on its
 *      next run and commit new work there instead.
 */

const path = require("path");
const { run, loadJson, saveJson, timestamp, loadConfig, stateFilePath } = require("./lib");

function fail(msg) {
  console.error(`[start-new-pr] ${msg}`);
  process.exit(1);
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function main() {
  const cwd = process.cwd();
  const slugArg = process.argv[2] || "";

  if (run(cwd, "git", ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    fail("not inside a git repository.");
  }

  const status = run(cwd, "git", ["status", "--porcelain"]);
  if (status) {
    fail(
      "there are uncommitted changes in the working tree. Let review-gate commit them first " +
        "(end this turn normally, or run the review-gate script directly the way /ship does), " +
        "then run start-new-pr again — otherwise those changes would silently follow you onto " +
        "the new branch instead of staying on the PR they actually belong to."
    );
  }

  const config = loadConfig(cwd);
  const protectedBranches = config.baseBranches || ["main", "master"];
  const base = protectedBranches[0] || "main";
  const branchPrefix = config.branchPrefix || "claude/";

  const oldBranch = run(cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!oldBranch) fail("could not determine the current branch.");

  if (run(cwd, "git", ["checkout", base]) === null) {
    fail(`could not check out base branch "${base}".`);
  }

  const slug = slugify(slugArg);
  const newBranch = `${branchPrefix}${slug ? slug + "-" : ""}${timestamp()}`;

  if (run(cwd, "git", ["checkout", "-b", newBranch]) === null) {
    fail(`could not create branch "${newBranch}".`);
  }

  const stateFile = stateFilePath(cwd);
  const state = loadJson(stateFile, {});
  let reassigned = 0;
  for (const sessionId of Object.keys(state)) {
    if (state[sessionId] === oldBranch) {
      state[sessionId] = newBranch;
      reassigned++;
    }
  }
  if (reassigned > 0) saveJson(stateFile, state);

  console.log(`OLD_BRANCH=${oldBranch}`);
  console.log(`NEW_BRANCH=${newBranch}`);
  console.log(`BASE_BRANCH=${base}`);
}

main();
