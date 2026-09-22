#!/usr/bin/env node
// Mock CLI invoked by tests, standing in for `gh` and/or `claude`. The
// shim/trampoline that wraps this file always passes its own tool name
// first, then that tool's real arguments — so one script can back both
// fakes. Scenario rules live in REVIEW_GATE_TEST_SCENARIO as
// { "<tool>": { "<space-joined args>": {stdout, code} } }, and every
// invocation is logged to REVIEW_GATE_TEST_LOG so tests can assert on it.
const fs = require("fs");

const [tool, ...args] = process.argv.slice(2);

const logFile = process.env.REVIEW_GATE_TEST_LOG;
if (logFile) {
  fs.appendFileSync(logFile, JSON.stringify([tool, ...args]) + "\n");
}

const scenarioFile = process.env.REVIEW_GATE_TEST_SCENARIO;
const scenario = scenarioFile
  ? JSON.parse(fs.readFileSync(scenarioFile, "utf8"))
  : {};
const rules = scenario[tool] || {};

// Rule keys are space-joined argv, "*" matches any one arg, and a trailing
// "**" matches any number of remaining args (used e.g. for `pr create`,
// whose --title/--body are generated from real diff/log output, and for
// `claude -p <prompt>`, whose prompt text we don't want tests to hardcode).
function matchesRule(ruleKey, argv) {
  const parts = ruleKey.split(" ");
  const trailing = parts[parts.length - 1] === "**";
  const fixed = trailing ? parts.slice(0, -1) : parts;
  if (trailing ? argv.length < fixed.length : argv.length !== fixed.length) {
    return false;
  }
  return fixed.every((part, i) => part === "*" || part === argv[i]);
}

const ruleKey = Object.keys(rules).find((k) => matchesRule(k, args));
const match = ruleKey ? rules[ruleKey] : null;
if (!match) {
  process.exit(1); // unmocked command: behave like "command failed"
}
if (match.stdout) process.stdout.write(match.stdout);
process.exit(match.code || 0);
