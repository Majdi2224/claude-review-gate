// Installs fake CLIs on PATH for tests, backed by fake-cli.js. On POSIX
// this is just a shebang shim per tool name. On Windows, execFileSync
// (which review-gate.js uses, deliberately without shell:true) can only
// launch real .exe files, not .cmd/.bat — so we compile one tiny C#
// trampoline per tool name (using csc.exe, which ships with the .NET
// Framework already on every Windows box) that re-execs
// `node fake-cli.js <tool> <args>` and forwards its exit code.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const FAKE_CLI_SCRIPT = path.join(__dirname, "fake-cli.js");

function findCsc() {
  const candidates = [
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
    "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let cachedBinDir = null;

// Returns a directory containing fake executables for each name in `names`
// (e.g. ["gh", "claude"]), or null if this platform can't produce one
// (missing csc.exe on Windows) — callers should skip in that case.
function installFakeBin(names) {
  if (cachedBinDir) return cachedBinDir;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-fakebin-"));

  if (process.platform !== "win32") {
    for (const name of names) {
      const shimPath = path.join(dir, name);
      fs.writeFileSync(
        shimPath,
        `#!/usr/bin/env node\nrequire(${JSON.stringify(FAKE_CLI_SCRIPT)});\n`
      );
      fs.chmodSync(shimPath, 0o755);
    }
    cachedBinDir = dir;
    return cachedBinDir;
  }

  const csc = findCsc();
  if (!csc) return null;

  for (const name of names) {
    // The old .NET Framework csc.exe on this box only compiles C# 5, which
    // predates ProcessStartInfo.ArgumentList — so we build the command-line
    // string ourselves using the standard Windows argv-quoting rules.
    const src = path.join(dir, name + ".cs");
    fs.writeFileSync(
      src,
      `using System;
using System.Diagnostics;
using System.Text;
class Trampoline {
  static string EscapeArg(string arg) {
    if (arg.Length != 0 && arg.IndexOfAny(new char[] { ' ', '\\t', '\\n', '\\v', '"' }) < 0) {
      return arg;
    }
    var sb = new StringBuilder();
    sb.Append('"');
    int i = 0;
    while (i < arg.Length) {
      char c = arg[i];
      if (c == '\\\\') {
        int n = 0;
        while (i < arg.Length && arg[i] == '\\\\') { n++; i++; }
        if (i == arg.Length) {
          sb.Append('\\\\', n * 2);
        } else if (arg[i] == '"') {
          sb.Append('\\\\', n * 2 + 1);
          sb.Append('"');
          i++;
        } else {
          sb.Append('\\\\', n);
        }
      } else if (c == '"') {
        sb.Append('\\\\').Append('"');
        i++;
      } else {
        sb.Append(c);
        i++;
      }
    }
    sb.Append('"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    var sb = new StringBuilder();
    sb.Append(EscapeArg(${JSON.stringify(FAKE_CLI_SCRIPT)}));
    sb.Append(' ').Append(EscapeArg(${JSON.stringify(name)}));
    foreach (var a in args) {
      sb.Append(' ').Append(EscapeArg(a));
    }
    var psi = new ProcessStartInfo("node", sb.ToString());
    psi.UseShellExecute = false;
    var p = Process.Start(psi);
    p.WaitForExit();
    return p.ExitCode;
  }
}`
    );
    execFileSync(csc, ["/nologo", "/out:" + path.join(dir, name + ".exe"), src]);
  }
  cachedBinDir = dir;
  return cachedBinDir;
}

// Creates a fresh scenario for one test: `rulesByTool` maps a tool name
// ("gh"/"claude") to a map of space-joined-argv -> {stdout, code}.
function newCliScenario(rulesByTool) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-scenario-"));
  const scenarioFile = path.join(dir, "scenario.json");
  const logFile = path.join(dir, "invocations.log");
  fs.writeFileSync(scenarioFile, JSON.stringify(rulesByTool));
  fs.writeFileSync(logFile, "");
  return {
    env: {
      REVIEW_GATE_TEST_SCENARIO: scenarioFile,
      REVIEW_GATE_TEST_LOG: logFile,
    },
    invocations() {
      return fs
        .readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

module.exports = { installFakeBin, newCliScenario };
