var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/replace.ts
import * as ToolBash from "@deepseek-ai/dsh-tool-bash";

// src/diag.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
var LOG_NAME = "dsh-terminal-shell.log";
function diagnosticPath() {
  const configured = process.env.DSH_TERMINAL_TOOL_DIAG_FILE;
  if (configured !== void 0 && configured.trim() !== "") return configured;
  return join(tmpdir(), LOG_NAME);
}
function stamp() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function writeDiagnostic(message) {
  const line = `[${stamp()}] ${message}
`;
  try {
    const path = diagnosticPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line, "utf8");
  } catch {
  }
}
function skip(sessionId, reason, detail) {
  const suffix = detail === void 0 || detail === "" ? "" : `: ${detail}`;
  writeDiagnostic(`skip session=${sessionId} reason=${reason}${suffix}`);
  return reason;
}
function warn(sessionId, message) {
  writeDiagnostic(`warn session=${sessionId} ${message}`);
}
function note(sessionId, message) {
  writeDiagnostic(`ok session=${sessionId} ${message}`);
}

// src/config.ts
import z from "@deepseek-ai/schemastery";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
var Config = z.object({
  ...LocalBashExecutor.Config.dict,
  /**
   * Which terminal tool the session gets. `pwsh` is the default on purpose:
   * installing the plugin must not change behaviour until the user asks for
   * bash or cmd (F9).
   */
  dialect: z.union(["pwsh", "bash", "cmd"]).default("pwsh").volatile(),
  /** Explicit bash executable. Empty means "discover". */
  bashPath: z.string().default("").volatile(),
  /**
   * Extra discovery roots or explicit executables, tried before the built-in
   * order. Accepts either a `bash.exe` or an installation root.
   */
  bashCandidates: z.array(z.string()).default([]).volatile(),
  /** Allow discovery when `bashPath` is empty. */
  autoDiscover: z.boolean().default(true).volatile(),
  /**
   * Upper bound for one discovery sweep. Discovery only stats the filesystem
   * (it never spawns a process), so this is a guard against pathological
   * candidate lists rather than a real timeout.
   */
  discoverTimeoutMs: z.number().default(1500).volatile(),
  /** Pass `-l` so the shell reads the login profile. */
  loginShell: z.boolean().default(false).volatile(),
  /** Directories prepended to the child PATH in addition to the install dirs. */
  extraPath: z.array(z.string()).default([]).volatile(),
  /** Export `PYTHONIOENCODING=utf-8` for the MSYS environment (F14). */
  pythonUtf8: z.boolean().default(true).volatile(),
  /**
   * What to do when a confined Windows sandbox cannot start Git Bash.
   *
   * - `unconfined` (default): launch bash directly, outside the sandbox. Nothing
   *   crashes, but the child is not file-sandboxed.
   * - `escalate`: keep the confined launch. The MSYS startup failure is then
   *   reported as a sandbox denial, which is what makes the first-party bash
   *   tool offer `sandbox_permissions` and lets the model retry with
   *   `danger-full-access` through the official approval flow. The approval
   *   itself belongs to that flow — the plugin never approves anything.
   */
  confinedPolicy: z.union(["unconfined", "escalate"]).default("unconfined").volatile(),
  /**
   * Explicit `cmd.exe`. Empty means "resolve it": `ComSpec`, then
   * `%SystemRoot%\System32\cmd.exe` (see `src/cmd/discover.ts`).
   *
   * Kept separate from `bashPath` on purpose: the two dialects are independent
   * and a user may switch back and forth without re-picking either.
   */
  cmdPath: z.string().default("").volatile(),
  /**
   * Console code page the generated batch file switches to before running the
   * command.
   *
   * `65001` (UTF-8) is the only value that makes non-ASCII output survive the
   * pipe, because the harness decodes child output as UTF-8 unconditionally.
   * The knob exists as an escape hatch for a command that must see the legacy
   * ANSI page (a tool that reads `chcp` and branches on it); changing it
   * reintroduces mojibake for non-ASCII output.
   */
  cmdCodePage: z.number().default(65001).volatile(),
  /**
   * How to launch `cmd.exe` under a confined sandbox policy.
   *
   * Unlike `confinedPolicy` there is no `fail` member: Git Bash cannot start
   * under a restricted Windows token (hence `confinedPolicy`), while `cmd.exe`
   * is what the official windows-acl backend itself probes with, so a confined
   * cmd launch is always possible.
   *
   * - `escalate` (default): honour the standing policy; a denial is reported as
   *   a sandbox denial, which is what lets the model ask for
   *   `sandbox_permissions: danger-full-access` through the official flow.
   * - `unconfined`: launch outside the sandbox, exactly like
   *   `confinedPolicy: 'unconfined'` does for Git Bash.
   */
  cmdConfinedPolicy: z.union(["escalate", "unconfined"]).default("escalate").volatile(),
  /**
   * How the official `minimal` preset is treated.
   *
   * `minimal` is the only shipped preset that runs a *persistent* shell, and on
   * Windows that shell is PowerShell (`dsh-tool-pwsh-persistent`). This plugin
   * only replaces the one-shot `bash` tool, so without this knob minimal
   * sessions silently fall back to a one-shot Git Bash.
   *
   * - `oneshot` (default): pre-0.5 behaviour — minimal gets the one-shot Git Bash.
   * - `leave`: minimal is untouched and keeps its persistent PowerShell.
   * - `variant`: minimal is untouched *and* a `minimal-gitbash` preset variant is
   *   registered so a new session can pick a persistent Git Bash.
   *
   * The default stays `oneshot` so upgrading does not change behaviour; the user
   * opts into the other two from the settings row.
   */
  minimalMode: z.union(["leave", "oneshot", "variant"]).default("oneshot").volatile()
});
function isVolatileLike(value) {
  return typeof value === "object" && value !== null && typeof value.get === "function";
}
function read(value, fallback) {
  const resolved = isVolatileLike(value) ? value.get() : value;
  if (resolved === void 0 || resolved === null) return fallback;
  return resolved;
}
function readArray(value) {
  const resolved = isVolatileLike(value) ? value.get() : value;
  if (!Array.isArray(resolved)) return [];
  return resolved.map((item) => String(item));
}
function readMinimalMode(value) {
  const resolved = read(value, "oneshot");
  if (resolved === "leave" || resolved === "variant") return resolved;
  return "oneshot";
}
function readConfinedPolicy(value) {
  const resolved = read(value, "unconfined");
  return resolved === "escalate" ? "escalate" : "unconfined";
}
function readCmdConfinedPolicy(value) {
  const resolved = read(value, "escalate");
  return resolved === "unconfined" ? "unconfined" : "escalate";
}
var DEFAULT_CMD_CODE_PAGE = 65001;
function readCodePage(value) {
  const resolved = Math.trunc(Number(read(value, DEFAULT_CMD_CODE_PAGE)));
  if (!Number.isFinite(resolved) || resolved < 1 || resolved > 65535) return DEFAULT_CMD_CODE_PAGE;
  return resolved;
}
function readDialect(value) {
  const resolved = read(value, "pwsh");
  if (resolved === "bash" || resolved === "cmd") return resolved;
  return "pwsh";
}
var DEFAULTS = {
  timeoutMs: 12e4,
  maxTimeoutMs: 6e5,
  maxOutputBytes: 64e3,
  maxSpillBytes: 64 * 1024 * 1024,
  graceMs: 3e3
};
function snapshotConfig(config) {
  const source = config;
  return Object.freeze({
    dialect: readDialect(source.dialect),
    bashPath: read(source.bashPath, "").trim(),
    bashCandidates: readArray(source.bashCandidates),
    autoDiscover: read(source.autoDiscover, true) !== false,
    discoverTimeoutMs: Math.max(0, Number(read(source.discoverTimeoutMs, 1500)) || 0),
    loginShell: read(source.loginShell, false) === true,
    extraPath: readArray(source.extraPath),
    pythonUtf8: read(source.pythonUtf8, true) !== false,
    confinedPolicy: readConfinedPolicy(source.confinedPolicy),
    cmdPath: read(source.cmdPath, "").trim(),
    cmdCodePage: readCodePage(source.cmdCodePage),
    cmdConfinedPolicy: readCmdConfinedPolicy(source.cmdConfinedPolicy),
    minimalMode: readMinimalMode(source.minimalMode),
    cwd: read(source.cwd, "") || void 0,
    timeoutMs: read(source.timeoutMs, DEFAULTS.timeoutMs),
    maxTimeoutMs: read(source.maxTimeoutMs, DEFAULTS.maxTimeoutMs),
    maxOutputBytes: read(source.maxOutputBytes, DEFAULTS.maxOutputBytes),
    maxSpillBytes: read(source.maxSpillBytes, DEFAULTS.maxSpillBytes),
    graceMs: read(source.graceMs, DEFAULTS.graceMs)
  });
}
function executorConfig(snapshot) {
  return {
    confinedPolicy: snapshot.confinedPolicy,
    cwd: snapshot.cwd,
    timeoutMs: snapshot.timeoutMs,
    maxTimeoutMs: snapshot.maxTimeoutMs,
    maxOutputBytes: snapshot.maxOutputBytes,
    maxSpillBytes: snapshot.maxSpillBytes,
    graceMs: snapshot.graceMs
  };
}

// src/executor.ts
import { LocalBashExecutor as LocalBashExecutor2 } from "@deepseek-ai/dsh-bash-local";
import {
  SandboxUnavailableError,
  classifyRunnerFailure as classifyRunnerFailureMatch,
  isRunnerSpawnFailure,
  matchesSignature
} from "@deepseek-ai/dsh-sandbox";

// src/paths.ts
import { existsSync, statSync } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join2, normalize, resolve, sep } from "node:path";
function pathKey(path) {
  let key = path.replace(/\//g, "\\").replace(/\\+$/, "");
  if (key === "") key = "\\";
  return key.toLowerCase();
}
function samePath(left, right) {
  return pathKey(left) === pathKey(right);
}
function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function bashInstallRoot(bashPath) {
  const absolute = resolve(bashPath);
  const directory = dirname2(absolute);
  if (samePath(directory, join2(installRootGuess(directory), "bin"))) return installRootGuess(directory);
  if (samePath(directory, join2(installRootGuess(directory), "usr", "bin"))) return installRootGuess(directory);
  return directory;
}
function installRootGuess(directory) {
  const leaf = directory.substring(directory.lastIndexOf(sep) + 1).toLowerCase();
  if (leaf === "bin") {
    const parent = dirname2(directory);
    const parentLeaf = parent.substring(parent.lastIndexOf(sep) + 1).toLowerCase();
    if (parentLeaf === "usr") return dirname2(parent);
    return parent;
  }
  return directory;
}
function bashPathEntries(root, extra = []) {
  const entries = [];
  const push = (candidate) => {
    if (candidate !== "" && isDirectory(candidate)) entries.push(candidate);
  };
  for (const name2 of ["ucrt64", "mingw64", "clang64", "mingw32"]) {
    push(join2(root, name2, "bin"));
  }
  push(join2(root, "usr", "bin"));
  push(join2(root, "bin"));
  push(join2(root, "usr", "local", "bin"));
  for (const item of extra) push(item);
  return dedupe(entries);
}
function dedupe(entries) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of entries) {
    const normalized = normalize(entry);
    const key = pathKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
function composePath(entries, hostPath) {
  const parts = [...entries];
  for (const part of (hostPath ?? "").split(";")) {
    if (part.trim() !== "") parts.push(part);
  }
  return dedupe(parts).join(";");
}
function validateBashPath(path) {
  const trimmed = path.trim();
  if (trimmed === "") return { ok: false, reason: "empty path" };
  if (!isAbsolute(trimmed)) return { ok: false, reason: "path is not absolute" };
  const normalized = resolve(trimmed);
  const leaf = normalized.substring(normalized.lastIndexOf(sep) + 1);
  const base = leaf.toLowerCase();
  if (base !== "bash" && base !== "bash.exe") {
    return { ok: false, reason: `executable name is "${leaf}", expected bash.exe` };
  }
  if (isWslBash(normalized)) {
    return { ok: false, reason: "WSL launcher, not Git Bash" };
  }
  if (isDirectory(normalized)) return { ok: false, reason: "path is a directory" };
  if (!isFile(normalized)) return { ok: false, reason: "file does not exist" };
  return { ok: true, path: normalized };
}
function isWslBash(path) {
  const key = pathKey(resolve(path));
  const windowsRoot = pathKey(process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows");
  if (key === `${windowsRoot}\\system32\\bash.exe`) return true;
  if (key.startsWith(`${windowsRoot}\\system32\\`)) return true;
  if (key.includes("\\windowsapps\\bash.exe")) return true;
  if (key.startsWith("\\\\?\\") && key.includes("\\windowsapps\\")) return true;
  return false;
}
function candidateExecutables(candidate) {
  const value = candidate.trim();
  if (value === "") return [];
  const absolute = resolve(value);
  if (!isAbsolute(value)) return [];
  const base = absolute.substring(absolute.lastIndexOf(sep) + 1).toLowerCase();
  if ((base === "bash" || base === "bash.exe") && existsSync(absolute)) return [absolute];
  const results = [];
  for (const suffix of [join2("bin", "bash.exe"), join2("usr", "bin", "bash.exe"), "bash.exe"]) {
    const path = join2(absolute, suffix);
    if (existsSync(path)) results.push(path);
  }
  return results;
}

// src/confined.ts
var MSYS_DENIAL_SIGNATURES = [
  "ntcreatedirectoryobject(\\basenamedobjects\\msys-",
  "couldn't create signal pipe"
];
var MSYS_DENIAL_EXIT_CODES = [3221225794, 3221225506];
function isMsysStartupDenial(exitCode, stderr) {
  if (exitCode !== null && exitCode !== void 0 && MSYS_DENIAL_EXIT_CODES.includes(exitCode)) return true;
  const lowered = stderr.toLowerCase();
  return MSYS_DENIAL_SIGNATURES.some((signature) => lowered.includes(signature));
}
function planLaunch(input) {
  if (!input.hasSandbox || input.policyMode === void 0) return { kind: "direct" };
  if (input.policyMode === "danger-full-access") return { kind: "direct" };
  if (input.platform !== "win32") return { kind: "confine" };
  if (input.choice === "unconfined") return { kind: "direct" };
  return { kind: "confine" };
}

// src/executor.ts
var GitBashExecutor = class extends LocalBashExecutor2 {
  /**
   * Only `subprocess` is injected. A composition without sandboxing must still
   * be able to mount this executor — the tool then simply has no escalation
   * parameter — so `sandbox` and `sandboxPolicy` are probed with `ctx.get()`,
   * matching how `tool-bash` treats them.
   */
  static inject = ["subprocess"];
  facts = /* @__PURE__ */ new Map();
  constructor(ctx, config) {
    super(ctx, config);
  }
  get extended() {
    return this.config;
  }
  get bashPath() {
    return this.extended.bashPath;
  }
  get pathEntries() {
    return this.extended.pathEntries;
  }
  get loginShell() {
    return this.extended.loginShell === true;
  }
  get pythonUtf8() {
    return this.extended.pythonUtf8 !== false;
  }
  get confinedPolicy() {
    return this.extended.confinedPolicy ?? "unconfined";
  }
  get sandbox() {
    return this.ctx.get("sandbox");
  }
  get sandboxPolicy() {
    return this.ctx.get("sandboxPolicy");
  }
  /**
   * The standing sandbox mode this executor can actually honour.
   *
   * `tool-bash` reads it to decide whether to expose `sandbox_permissions` and
   * whether the composition must provide a `sandboxPolicy` service, so it must
   * be `undefined` whenever the next launch would bypass the sandbox: under
   * `unconfined` on Windows every command runs outside it (see `planLaunch`),
   * and advertising the session's confined mode would describe commands as
   * sandboxed when they are not. `danger-full-access` stays visible, because
   * that mode really is unconfined.
   */
  get sandboxMode() {
    const mode = this.sandboxPolicy?.defaultMode;
    if (this.sandbox === void 0 || mode === void 0) return void 0;
    return this.bypassesSandbox(mode) ? void 0 : mode;
  }
  /** Whether `mode` would be launched outside the sandbox in this composition. */
  bypassesSandbox(mode) {
    if (mode === "danger-full-access") return false;
    return planLaunch({
      hasSandbox: true,
      policyMode: mode,
      choice: this.confinedPolicy,
      platform: process.platform
    }).kind === "direct";
  }
  /** The exact argv for one command. */
  argv(spec) {
    return [this.bashPath, ...this.loginShell ? ["-l"] : [], "-c", spec.command];
  }
  resolve(request) {
    const spec = super.resolve(request);
    const env = {
      ...spec.env,
      PATH: composePath(this.pathEntries, spec.env?.PATH ?? process.env.PATH ?? process.env.Path)
    };
    if (this.pythonUtf8 && env.PYTHONIOENCODING === void 0) env.PYTHONIOENCODING = "utf-8";
    return {
      ...spec,
      env,
      // `tool-bash` normally supplies the policy; this fallback keeps a direct
      // caller (tests, other tools) from reaching `confine()` with no policy.
      sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve()
    };
  }
  async execute(spec) {
    const sandbox = this.sandbox;
    const policy = spec.sandboxPolicy;
    const argv = this.argv(spec);
    const plan = planLaunch({
      hasSandbox: sandbox !== void 0,
      policyMode: policy?.mode,
      choice: this.confinedPolicy,
      platform: process.platform
    });
    if (plan.kind === "direct") {
      const bypassed = policy !== void 0 && policy.mode !== "danger-full-access";
      const facts = { mode: bypassed ? "danger-full-access" : policy?.mode ?? "danger-full-access", denied: false };
      const execution2 = await this.executeArgv(spec, argv);
      return decorateResult(execution2, (result) => ({ ...result, sandbox: facts }));
    }
    if (sandbox === void 0 || policy === void 0) {
      throw new Error("confined launch plan without a sandbox provider or policy");
    }
    const mode = policy.mode;
    if (mode === "danger-full-access") {
      throw new Error("confined launch plan with an unconfined sandbox policy");
    }
    const confinedPolicy = { ...policy, mode };
    let confined;
    const execution = await this.executeArgv(
      spec,
      async (signal) => {
        const prepared = await sandbox.confine(argv, confinedPolicy, signal);
        signal.throwIfAborted();
        confined = prepared;
        return prepared.argv;
      },
      (process2) => {
        const prepared = confined;
        if (prepared === void 0) return;
        this.facts.set(process2, {
          mode,
          enforcement: prepared.enforcement,
          denialSignatures: prepared.denialSignatures,
          runnerFailureRules: prepared.runnerFailureRules,
          runnerProgram: prepared.argv[0] ?? argv[0] ?? this.bashPath,
          workdir: spec.workdir
        });
      }
    );
    return decorateResult(
      execution,
      (result) => {
        if (confined === void 0) return { ...result, sandbox: { mode, denied: false } };
        const failure = classifyRunnerFailureMatch(result.exitCode, result.stderr.text, confined.runnerFailureRules);
        if (failure !== void 0) {
          throw new SandboxUnavailableError(mode, failure.detail);
        }
        return {
          ...result,
          sandbox: {
            mode,
            denied: matchesSignature(result.exitCode, result.stderr.text, confined.denialSignatures) || isMsysStartupDenial(result.exitCode, result.stderr.text),
            enforcement: confined.enforcement
          }
        };
      },
      (error) => {
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
        if (confined === void 0) throw error;
        if (isRunnerSpawnFailure(error, confined.argv[0], spec.workdir)) {
          throw new SandboxUnavailableError(mode, error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    );
  }
  onProcessDone(process2, stderr, providerRejected, providerError) {
    const facts = this.facts.get(process2);
    this.facts.delete(process2);
    if (facts !== void 0) {
      const runnerFailed = providerRejected ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir) : classifyRunnerFailureMatch(process2.exitCode, stderr, facts.runnerFailureRules) !== void 0;
      process2.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && (matchesSignature(process2.exitCode, stderr, facts.denialSignatures) || isMsysStartupDenial(process2.exitCode, stderr)),
        enforcement: facts.enforcement,
        ...runnerFailed ? { runnerFailed: true } : {}
      };
    }
    super.onProcessDone(process2, stderr, providerRejected, providerError);
  }
};
function decorateResult(execution, map, mapError) {
  const base = execution.result.bind(execution);
  let decorated;
  execution.result = () => {
    decorated ??= mapError === void 0 ? base().then(map) : base().then(map, mapError);
    return decorated;
  };
  return execution;
}

// src/discover.ts
import { execFile } from "node:child_process";
import { delimiter, dirname as dirname3, join as join3, resolve as resolve2 } from "node:path";
async function registryInstallPath(signal) {
  if (process.platform !== "win32") return void 0;
  const output = await new Promise((done) => {
    execFile(
      "reg.exe",
      ["query", "HKLM\\SOFTWARE\\GitForWindows", "/v", "InstallPath"],
      { encoding: "utf8", timeout: 1e3, windowsHide: true, signal },
      (error, stdout) => {
        if (error !== null) done(void 0);
        else done(stdout);
      }
    );
  });
  if (output === void 0) return void 0;
  const match = /InstallPath\s+REG_[A-Z_]+\s+(.+?)\s*$/im.exec(output);
  return match?.[1]?.trim();
}
function environmentRoots() {
  const roots = [];
  const push = (root, source) => {
    if (root === void 0 || root.trim() === "") return;
    roots.push({ path: resolve2(root), source });
  };
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const systemDrive = process.env.SystemDrive ?? "C:";
  push(programFiles === void 0 ? void 0 : join3(programFiles, "Git"), "program-files");
  push(programFilesX86 === void 0 ? void 0 : join3(programFilesX86, "Git"), "program-files");
  push(localAppData === void 0 ? void 0 : join3(localAppData, "Programs", "Git"), "program-files");
  push(programFiles === void 0 ? void 0 : join3(programFiles, "MSYS2"), "msys2");
  push(join3(systemDrive, "msys64"), "msys2");
  push(localAppData === void 0 ? void 0 : join3(localAppData, "MSYS2"), "msys2");
  push(join3(systemDrive, "cygwin64"), "cygwin");
  push(join3(systemDrive, "cygwin"), "cygwin");
  return roots;
}
function bashFromGitOnPath() {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  for (const entry of pathValue.split(delimiter)) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    for (const name2 of ["git.exe", "git.cmd", "git.bat"]) {
      const git = join3(trimmed, name2);
      if (!isFile(git)) continue;
      const root = resolve2(dirname3(git), "..");
      for (const suffix of [join3("bin", "bash.exe"), join3("usr", "bin", "bash.exe")]) {
        const bash = join3(root, suffix);
        if (isFile(bash)) return { path: bash, source: "path" };
      }
    }
  }
  return void 0;
}
function expand(candidate) {
  return candidateExecutables(candidate.path).map((path) => ({ path, source: candidate.source }));
}
async function enumerateCandidates(options) {
  const rejected = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (candidate) => {
    const key = candidate.path.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (isWslBash(candidate.path)) {
      rejected.push({ path: candidate.path, reason: "WSL launcher, not Git Bash" });
      return;
    }
    ordered.push(candidate);
  };
  const ordered = [];
  const explicit = options.bashPath.trim();
  if (explicit !== "") {
    push({ path: explicit, source: "configured" });
  }
  if (options.autoDiscover && !(options.explicitWins && explicit !== "")) {
    for (const item of options.bashCandidates) {
      if (item.trim() === "") continue;
      for (const candidate of expand({ path: item, source: "candidate" })) push(candidate);
    }
    const controller = new AbortController();
    const timer = options.timeoutMs > 0 ? setTimeout(() => {
      controller.abort(new Error("discovery timeout"));
    }, options.timeoutMs) : void 0;
    const signal = options.signal === void 0 ? controller.signal : AbortSignal.any([options.signal, controller.signal]);
    try {
      const registry = await registryInstallPath(signal);
      if (registry !== void 0 && !signal.aborted) {
        for (const candidate of expand({ path: registry, source: "registry" })) push(candidate);
      }
      for (const root of environmentRoots()) {
        for (const candidate of expand(root)) push(candidate);
      }
      const fromPath = bashFromGitOnPath();
      if (fromPath !== void 0) push(fromPath);
    } finally {
      if (timer !== void 0) clearTimeout(timer);
    }
  }
  const usable = [];
  for (const candidate of ordered) {
    const verdict = validateBashPath(candidate.path);
    if (verdict.ok) usable.push(candidate);
    else rejected.push({ path: candidate.path, reason: verdict.reason });
  }
  return { ordered: usable, rejected };
}
async function discoverBash(options) {
  const { ordered, rejected } = await enumerateCandidates({ ...options, explicitWins: true });
  const considered = ordered.map((candidate) => candidate.path);
  const found = ordered[0];
  if (found === void 0) return { found: void 0, considered, rejected };
  return { found: { path: found.path, source: found.source }, considered, rejected };
}

// src/cmd/executor.ts
import { LocalBashExecutor as LocalBashExecutor3 } from "@deepseek-ai/dsh-bash-local";
import {
  SandboxUnavailableError as SandboxUnavailableError2,
  classifyRunnerFailure as classifyRunnerFailureMatch2,
  isRunnerSpawnFailure as isRunnerSpawnFailure2,
  matchesSignature as matchesSignature2
} from "@deepseek-ai/dsh-sandbox";
import { rmSync as rmSync2, statSync as statSync3 } from "node:fs";

// src/cmd/script.ts
import { mkdirSync as mkdirSync2, readdirSync, rmSync, statSync as statSync2, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname as dirname4, join as join4 } from "node:path";
import { tmpdir as tmpdir2 } from "node:os";
var SCRATCH_PREFIX = "dsh-cmd-";
var SCRIPT_PREFIX = "cmd-";
var STALE_MS = 24 * 60 * 60 * 1e3;
function crlf(text) {
  return text.replace(/\r\n?|\n/g, "\r\n");
}
function escapeBatchPath(path) {
  return path.replace(/%/g, "%%");
}
function renderCmdScript(command, options) {
  const lines = ["@echo off", `chcp ${options.codePage}>nul`];
  const verb = options.workdir.startsWith("\\\\") ? "pushd" : "cd /d";
  const target = escapeBatchPath(options.workdir);
  lines.push(`${verb} "${target}" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)`);
  lines.push(crlf(command));
  return `${lines.join("\r\n")}\r
`;
}
function ensureScratchDir(root) {
  const dir = root ?? join4(tmpdir2(), `${SCRATCH_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`);
  mkdirSync2(dir, { recursive: true });
  return dir;
}
function materializeCmd(dir, command, options) {
  const path = join4(dir, `${SCRIPT_PREFIX}${randomUUID()}.cmd`);
  writeFileSync(path, renderCmdScript(command, options), "utf8");
  let disposed = false;
  return {
    path,
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        rmSync(path, { force: true });
      } catch {
      }
    }
  };
}
function scriptArgv(cmdPath, script) {
  return { argv: [cmdPath, "/d", "/q", "/c", basename(script.path)], cwd: dirname4(script.path) };
}
function sweepStaleScripts(now = Date.now(), root = tmpdir2()) {
  let removed = 0;
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue;
    const dir = join4(root, entry);
    try {
      const info = statSync2(dir);
      if (!info.isDirectory() || now - info.mtimeMs < STALE_MS) continue;
      rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch {
    }
  }
  return removed;
}

// src/cmd/executor.ts
function planCmdLaunch(hasSandbox, policyMode, choice) {
  if (!hasSandbox || policyMode === void 0) return { kind: "direct", mode: "danger-full-access" };
  if (policyMode === "danger-full-access") return { kind: "direct", mode: "danger-full-access" };
  if (choice === "unconfined") return { kind: "direct", mode: "danger-full-access" };
  return { kind: "confine", mode: policyMode };
}
var CmdExecutor = class extends LocalBashExecutor3 {
  // No `as const`: the base class declares `static inject: string[]`, so a
  // readonly tuple is TS2417.
  static inject = ["subprocess"];
  facts = /* @__PURE__ */ new Map();
  scripts = /* @__PURE__ */ new Map();
  scratchDir;
  constructor(ctx, config) {
    super(ctx, config);
    this.ctx.effect(() => () => {
      const dir = this.scratchDir;
      this.scratchDir = void 0;
      if (dir === void 0) return;
      try {
        rmSync2(dir, { recursive: true, force: true });
      } catch {
      }
    }, "cmd-executor: scratch");
  }
  get extended() {
    return this.config;
  }
  get cmdPath() {
    return this.extended.cmdPath;
  }
  get codePage() {
    return this.extended.codePage ?? 65001;
  }
  get pythonUtf8() {
    return this.extended.pythonUtf8 !== false;
  }
  get confinedPolicy() {
    return this.extended.confinedPolicy ?? "escalate";
  }
  get sandbox() {
    return this.ctx.get("sandbox");
  }
  get sandboxPolicy() {
    return this.ctx.get("sandboxPolicy");
  }
  get scratch() {
    this.scratchDir ??= ensureScratchDir();
    return this.scratchDir;
  }
  /**
   * Report a sandbox mode only when the next launch would actually confine.
   *
   * The tool uses `undefined` to decide whether to advertise
   * `sandbox_permissions`; claiming a mode the executor then bypasses would offer
   * the model an escalation that changes nothing.
   */
  get sandboxMode() {
    const mode = this.sandboxPolicy?.defaultMode;
    if (this.sandbox === void 0 || mode === void 0) return void 0;
    if (mode === "danger-full-access") return mode;
    return this.confinedPolicy === "unconfined" ? void 0 : mode;
  }
  /**
   * Inject PATH and encoding.
   *
   * `spawnSpec` merges `spec.env` after the built-in overrides and before
   * `dshEnv`, so `resolve()` is the only place a PATH can be supplied.
   * `PYTHONIOENCODING` matters here for the same reason it matters for bash:
   * Python writes to a pipe using the locale encoding unless told otherwise, and
   * the harness decodes every pipe as UTF-8.
   */
  resolve(request) {
    const spec = super.resolve(request);
    const env = { ...spec.env };
    if (this.extended.pathEntries.length > 0) {
      env.PATH = composePath(this.extended.pathEntries, spec.env?.PATH ?? process.env.PATH ?? process.env.Path);
    }
    if (this.pythonUtf8 && env.PYTHONIOENCODING === void 0) env.PYTHONIOENCODING = "utf-8";
    return { ...spec, env, sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve() };
  }
  async execute(spec) {
    assertDirectory(spec.workdir, "working directory");
    const script = materializeCmd(this.scratch, spec.command, {
      codePage: this.codePage,
      workdir: spec.workdir
    });
    const { argv, cwd } = scriptArgv(this.cmdPath, script);
    const spawnSpec = { ...spec, workdir: cwd };
    const sandbox = this.sandbox;
    const policy = spec.sandboxPolicy;
    const plan = planCmdLaunch(sandbox !== void 0, policy?.mode, this.confinedPolicy);
    let registered = false;
    try {
      if (plan.kind === "direct") {
        const facts = { mode: plan.mode, denied: false };
        const execution2 = await this.executeArgv(spawnSpec, argv, (process2) => {
          registered = true;
          this.scripts.set(process2, script);
        });
        return decorateResult2(execution2, (result) => ({ ...result, sandbox: facts }));
      }
      if (sandbox === void 0 || policy === void 0 || policy.mode === "danger-full-access") {
        throw new Error("cmd-executor: confined launch without a confined sandbox policy");
      }
      const confinedPolicy = { ...policy, mode: plan.mode };
      let confined;
      const execution = await this.executeArgv(
        spawnSpec,
        async (signal) => {
          const prepared = await sandbox.confine(argv, confinedPolicy, signal);
          signal.throwIfAborted();
          confined = prepared;
          return prepared.argv;
        },
        (process2) => {
          registered = true;
          this.scripts.set(process2, script);
          this.facts.set(process2, {
            mode: plan.mode,
            enforcement: confined?.enforcement,
            denialSignatures: confined?.denialSignatures ?? [],
            runnerFailureRules: confined?.runnerFailureRules ?? [],
            runnerProgram: confined?.argv[0] ?? argv[0] ?? this.cmdPath,
            workdir: spec.workdir
          });
        }
      );
      return decorateResult2(
        execution,
        (result) => {
          const ready = confined;
          if (ready === void 0) return { ...result, sandbox: { mode: plan.mode, denied: false } };
          const failure = classifyRunnerFailureMatch2(result.exitCode, result.stderr.text, ready.runnerFailureRules);
          if (failure !== void 0) {
            throw new SandboxUnavailableError2(plan.mode, failure.detail);
          }
          return {
            ...result,
            sandbox: {
              mode: plan.mode,
              denied: matchesSignature2(result.exitCode, result.stderr.text, ready.denialSignatures),
              enforcement: ready.enforcement
            }
          };
        },
        (error) => {
          if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
          const ready = confined;
          if (ready !== void 0 && isRunnerSpawnFailure2(error, ready.argv[0], spec.workdir)) {
            throw new SandboxUnavailableError2(plan.mode, error instanceof Error ? error.message : String(error));
          }
          throw error;
        }
      );
    } finally {
      if (!registered) script.dispose();
    }
  }
  /**
   * Settle sandbox facts and drop the script.
   *
   * The script cannot be removed when the *tool call* returns: a promoted timeout
   * keeps the process running as a background job, and cmd re-reads its batch
   * file line by line. Only a finished process makes the file dead weight.
   */
  onProcessDone(process2, stderr, providerRejected, providerError) {
    this.scripts.get(process2)?.dispose();
    this.scripts.delete(process2);
    const facts = this.facts.get(process2);
    this.facts.delete(process2);
    if (facts !== void 0) {
      const runnerFailed = providerRejected ? isRunnerSpawnFailure2(providerError, facts.runnerProgram, facts.workdir) : classifyRunnerFailureMatch2(process2.exitCode, stderr, facts.runnerFailureRules) !== void 0;
      process2.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature2(process2.exitCode, stderr, facts.denialSignatures),
        ...facts.enforcement !== void 0 ? { enforcement: facts.enforcement } : {},
        ...runnerFailed ? { runnerFailed: true } : {}
      };
    }
    super.onProcessDone(process2, stderr, providerRejected, providerError);
  }
};
function assertDirectory(path, label) {
  let ok = false;
  try {
    ok = statSync3(path).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(`cmd: ${label} does not exist: ${path}`);
}
function decorateResult2(execution, map, mapError) {
  const base = execution.result.bind(execution);
  let decorated;
  execution.result = () => {
    decorated ??= mapError === void 0 ? base().then(map) : base().then(map, mapError);
    return decorated;
  };
  return execution;
}

// src/cmd/discover.ts
import { statSync as statSync4 } from "node:fs";
import { join as join5 } from "node:path";
function isFile2(path) {
  try {
    return statSync4(path).isFile();
  } catch {
    return false;
  }
}
function isCmdExecutable(path) {
  const name2 = path.trim().replace(/[\\/]+$/, "");
  const base = name2.slice(Math.max(name2.lastIndexOf("\\"), name2.lastIndexOf("/")) + 1);
  return base.toLowerCase() === "cmd.exe";
}
function discoverCmd(configured, env = process.env) {
  const trimmed = configured.trim();
  if (trimmed !== "" && isCmdExecutable(trimmed) && isFile2(trimmed)) return { path: trimmed, source: "config" };
  const comspec = env.ComSpec ?? env.COMSPEC;
  if (comspec !== void 0 && comspec.trim() !== "" && isFile2(comspec)) {
    return { path: comspec, source: "comspec" };
  }
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
  if (systemRoot !== void 0 && systemRoot.trim() !== "") {
    const path = join5(systemRoot, "System32", "cmd.exe");
    if (isFile2(path)) return { path, source: "system-root" };
  }
  return void 0;
}

// src/cmd/prompt.ts
var CMD_PROMPT_SECTION = [
  "## The `cmd` tool",
  "",
  "`cmd` runs a Windows `cmd.exe` command and returns stdout/stderr. Each call is a",
  "fresh shell.",
  "",
  "- The contract is cmd-dialect: native `C:\\...` paths, `%VAR%` for environment",
  "  variables (not `$env:VAR`), `/` switches (`dir /b`).",
  "- The command runs from a one-shot batch file, so `%VAR%` expands, `&`/`&&`/`||`",
  "  chain, pipes and redirection work, and `( )` blocks, `if`, `for`, `call :label`",
  "  and multi-line commands behave as in a `.cmd` file.",
  "- `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to the internal batch file, not to your",
  "  command; use `%CD%` for the working directory.",
  "- Nothing persists between calls. Use `workdir` instead of `cd`."
].join("\n");

// src/cmd/tool.ts
var tool_exports = {};
__export(tool_exports, {
  Config: () => Config2,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
import { isAbsolute as isAbsolute2, sep as sep2 } from "node:path";

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
import { createRequire } from "node:module";

// node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js
import { Context, Service } from "@deepseek-ai/cordis";
var RemoteError = class extends Error {
  code;
  details;
  /** Structural marker: cross-realm/bundle identification never uses instanceof. */
  isDSHRemoteError = true;
  /**
  * @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
  * @param message - human diagnostic carried across the wire.
  * @param details - structured payload typed by the code.
  * @param options - standard Error options (`cause` survives in-process only).
  */
  constructor(code, message, details, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = "RemoteError";
  }
};
var TYPERT_OWNED_VALUE = Symbol.for("dsh.typert.owned-value");
var TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function isTypertRemoteSegment(value) {
  return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
var REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
function bindTypertRemote(service2, serviceKey, options = {}) {
  validateName("service key", serviceKey);
  const namespace = options.namespace ?? serviceKey;
  validateName("namespace", namespace);
  const ctx = Reflect.get(service2, "ctx");
  if (Context.is(ctx)) provideInvocationAccessor(ctx);
  return Object.freeze({
    service: service2,
    serviceKey,
    namespace
  });
}
var TypertRemoteService = class extends Service {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  typertRemote;
  /**
  * Register the Service and bind the same key to Typert Gateway.
  * @param ctx - owning Cordis Context.
  * @param serviceKey - exact Cordis service key and default wire namespace.
  * @param options - optional wire namespace.
  */
  constructor(ctx, serviceKey, options = {}) {
    super(ctx, serviceKey);
    this.typertRemote = bindTypertRemote(this, this.name, options);
  }
};
function provideInvocationAccessor(ctx) {
  if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
  ctx.root.accessor("invocation", { get: () => void 0 });
}
function Remote(methodExportOrOptions, context) {
  if (typeof methodExportOrOptions === "string") {
    validateName("Remote export name", methodExportOrOptions);
    return remoteDecorator({ kind: "direct" }, { exportName: methodExportOrOptions });
  }
  if (typeof methodExportOrOptions === "object") return remoteDecorator({ kind: "direct" }, markerOptions(methodExportOrOptions, REMOTE_OPTION_KEYS, 'Remote options require name, mode: "stream", or resources'));
  if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
  addMarkerInitializer(context, { kind: "direct" });
}
var REMOTE_OPTION_KEYS = /* @__PURE__ */ new Set([
  "name",
  "mode",
  "resources"
]);
function markerOptions(options, accepted, requirement) {
  const keys = Reflect.ownKeys(options);
  if (keys.length === 0 || keys.some((key) => typeof key !== "string" || !accepted.has(key)) || Object.hasOwn(options, "mode") && options.mode !== "stream") throw new TypeError(`typert-protocol: ${requirement}`);
  const { mode, name: name2, resources } = options;
  if (name2 !== void 0) validateName("Remote export name", name2);
  return {
    ...mode === void 0 ? {} : { mode },
    ...name2 === void 0 ? {} : { exportName: name2 },
    ...resources === void 0 ? {} : { resources: resourceReaders(resources) }
  };
}
function resourceReaders(resources) {
  const readers = {};
  for (const [kind, reader] of Object.entries(resources)) {
    if (typeof reader !== "function") throw new TypeError(`typert-protocol: Remote resource reader "${kind}" must be a function`);
    readers[kind] = reader;
  }
  if (Object.keys(readers).length === 0) throw new TypeError("typert-protocol: Remote resources require at least one reader");
  return Object.freeze(readers);
}
function remoteDecorator(invocation, options = {}) {
  return function(_method, context) {
    addMarkerInitializer(context, invocation, options);
  };
}
function readRemoteMethodDescriptor(prototype) {
  const property = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
  if (property === void 0) return void 0;
  const descriptor = property.value;
  if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
  const version2 = Reflect.get(descriptor, "version");
  if (version2 !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version2)}`);
  const methods = Reflect.get(descriptor, "methods");
  if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
  return descriptor;
}
function addMarkerInitializer(context, invocation, options = {}) {
  if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
  const method = context.name;
  context.addInitializer(function() {
    const prototype = Object.getPrototypeOf(this);
    if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
    mark(prototype, method, invocation, options);
  });
}
function mark(prototype, method, invocation, { mode, exportName, resources }) {
  const descriptor = readRemoteMethodDescriptor(prototype);
  const marker = Object.freeze({
    method,
    ...exportName === void 0 || exportName === method ? {} : { exportName },
    ...mode === void 0 ? {} : { mode },
    invocation: Object.freeze(invocation),
    ...resources === void 0 ? {} : { resources }
  });
  const current = descriptor?.methods.find((candidate) => candidate.method === method);
  if (current !== void 0) {
    if (current.exportName === marker.exportName && current.mode === marker.mode && current.resources === marker.resources && sameInvocation(current.invocation, invocation)) return;
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...descriptor?.methods ?? [], marker])
    })
  });
}
function sameInvocation(left, right) {
  if (left.kind === "direct") return right.kind === "direct";
  if (right.kind === "direct") return false;
  return left.context === right.context;
}
function validateName(subject, value) {
  if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}

// node_modules/@deepseek-ai/dsh-util-values/lib/index.js
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class PartialArguments2 {
  /** The view of a call with no arguments available. */
  static EMPTY = PartialArguments2.fromObject({});
  /**
  * View finished argument text without scanning it until a reader asks.
  * @param text - the complete argument JSON text.
  * @returns a sealed view.
  */
  static fromText(text) {
    const view = new PartialArguments2();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
  * View an already parsed argument payload, such as a PTC dispatch object.
  * @param value - the parsed argument value.
  * @returns a sealed view; a non-object payload has no fields.
  */
  static fromObject(value) {
    const view = new PartialArguments2();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
  * The source: text so far or a parsed object, plus whether it can still grow.
  * These are the only enumerable fields, so two views over the same source
  * compare equal structurally however far each has been read.
  */
  chunks = [];
  object;
  sealed = false;
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
  * Retain streamed argument text without scanning or comparing observed answers.
  * @param fragment - the text following every fragment appended before.
  */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
  * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
  * @param text - the final argument text, which replaces missing or conflicting deltas.
  * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
  */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return PartialArguments2.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return PartialArguments2.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
  * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
  * @returns whether any observed answer changed since its first read or the preceding refresh.
  */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read2 of this.#reads.values()) {
      if (read2.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read2) || changed;
    }
    if (completions) {
      for (const read2 of this.#reads.values()) if (read2.completion) changed = this.refreshRead(read2) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read2) {
    const now = read2.answer();
    if (Object.is(now, read2.last)) return false;
    read2.last = now;
    return true;
  }
  /**
  * Check whether no further fields can arrive.
  * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
  */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
  * List discovered fields in first-appearance order.
  * @returns top-level keys seen so far, in first-appearance order.
  */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
  * Check whether a top-level field has appeared.
  * @param key - argument name.
  * @returns whether the field has appeared (a string opened or another value began).
  */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
  * Check whether a field's closing delimiter has arrived, without validating its contents.
  * @param key - argument name.
  * @returns whether its delimiter arrived and no content reader has reported an error for this value.
  */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
  * Read string length without materializing its text.
  * @param key - argument name.
  * @param options - change granularity for a streaming string.
  * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
  */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
  }
  /**
  * Check a string against a decoded UTF-16 length limit without materializing it.
  * @param key - argument name.
  * @param maxLength - decoded UTF-16 limit, floored to at least zero.
  * @returns whether the string is longer than the limit; false when absent or not a string.
  */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
  }
  /**
  * Read a decoded string, including a streaming prefix.
  * @param key - argument name.
  * @returns the string field's decoded text so far; undefined when absent or not a string.
  */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
  * Read at most the first decoded UTF-16 units of a string.
  * @param key - argument name.
  * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
  * @returns the bounded string prefix; undefined when absent or not a string.
  */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
  }
  /**
  * Read a completed non-string argument.
  * @param key - argument name.
  * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
  */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read2, comparison) {
    this.scan();
    const result = read2();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) this.#reads.set(id, {
        completion: kind === "complete",
        answer: comparison === void 0 ? read2 : () => comparison(read2()),
        last: comparison === void 0 ? result : comparison(result)
      });
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read2 = entry.length ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read2, limit, false);
    return read2.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = {
        at: entry.end,
        length: text.length,
        text
      };
    }
    const read2 = entry.text ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read2, Number.POSITIVE_INFINITY, true);
    return read2.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read2 = prefixes.get(maxLength);
    if (read2 === void 0) {
      read2 = {
        at: entry.start,
        length: 0,
        text: ""
      };
      prefixes.set(maxLength, read2);
    }
    this.readString(entry, read2, maxLength, true);
    return read2.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field = this.object[key];
      return typeof field === "string" ? void 0 : field;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) try {
      entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
    } catch (_error) {
      entry.invalid = true;
      this.#invalidValue = true;
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read2, limit, materialize) {
    const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
    if (!entry.needsDecoding) {
      const length = Math.min(end - read2.at, limit - read2.length);
      if (length <= 0) return;
      if (materialize) read2.text += this.slice(read2.at, read2.at + length);
      read2.at += length;
      read2.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read2.at);
    while (read2.at < end && read2.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read2.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read2.length);
      if (length > 0) {
        if (materialize) read2.text += remaining.slice(0, length);
        read2.at += length;
        read2.length += length;
        if (read2.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read2.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read2.at + 2, Math.min(end, read2.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
      if (decoded === void 0) {
        entry.invalidAt = read2.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read2.text += decoded;
      read2.length++;
      read2.at += width;
      while (chunkIndex < this.chunks.length && read2.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote = fragment.indexOf('"', at);
      const end = quote < 0 ? fragment.length : quote;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote < 0 && escaped;
      if (quote < 0 || !escaped) return end;
      at = quote + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) try {
      this.#key = JSON.parse(`"${raw}"`);
    } catch (_error) {
      this.fail();
      return;
    }
    else this.#key = raw;
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({
      kind: "value",
      start: at,
      end: -1,
      parsed: void 0,
      invalid: false
    });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{
    kind: "visit",
    node: value
  }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({
        kind: "visit",
        node: task.source[task.key]
      });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({
        kind: "property",
        source: node,
        key
      });
    }
  }
  return value;
}

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
import z2 from "@deepseek-ai/schemastery";

// node_modules/@deepseek-ai/dsh-timeout/lib/index.js
var MAX_TIMER_DELAY_MS = 2147483647;

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
function freezeMessage(message) {
  return deepFreeze(structuredClone(message));
}
var HarnessError = class extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
var TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
var EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
var DEFAULT_MAX_RETRIES = 5;
var DEFAULT_INITIAL_DELAY_MS = 500;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_JITTER_RATIO = 0.1;
var DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT"
]);
var backoffSchema = z2.object({
  initialDelayMs: z2.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: z2.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: z2.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
var normalPolicySchema = z2.object({
  mode: z2.const("normal").required(),
  maxRetries: z2.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: z2.array(z2.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema
});
var alwaysPolicySchema = z2.object({
  mode: z2.const("always").required(),
  backoff: backoffSchema
});
var RetryPolicySchema = z2.union([normalPolicySchema, alwaysPolicySchema]);
var NORMAL_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var ALWAYS_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var BACKOFF_KEYS = /* @__PURE__ */ new Set([
  "initialDelayMs",
  "maxDelayMs",
  "jitterRatio"
]);
function validateKeys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
  if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
  return Object.freeze({
    initialDelayMs,
    maxDelayMs,
    jitterRatio
  });
}
function resolveRetryPolicy(config, path) {
  if (config === void 0) return Object.freeze({
    mode: "normal",
    maxRetries: DEFAULT_MAX_RETRIES,
    retryableCodes: DEFAULT_RETRYABLE_CODES,
    ...resolveBackoff(void 0, `${path}.backoff`)
  });
  switch (config.mode) {
    case "normal": {
      validateKeys(config, NORMAL_POLICY_KEYS, path);
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
      if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
      if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
      if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
      return Object.freeze({
        mode: "normal",
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    }
    case "always":
      validateKeys(config, ALWAYS_POLICY_KEYS, path);
      return Object.freeze({
        mode: "always",
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`);
  }
}
function callConfigEquals(a, b) {
  if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
  if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
function normalizeLlmFailure(value) {
  const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
  const carried = ownFailureSnapshot(error);
  if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error)
  });
}
function thrownMessage(value) {
  try {
    const message = String(value);
    return message.length > 0 ? message : "LLM adapter failed";
  } catch (_hostileThrownValue) {
    return "LLM adapter failed";
  }
}
function ownErrorCode(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function ownFailureSnapshot(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
    return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function failureSnapshot(value) {
  if (typeof value !== "object" || value === null) return void 0;
  try {
    const candidate = value;
    const message = candidate.message;
    const code = candidate.code;
    const status = candidate.status;
    const providerRetryAfterMs = candidate.providerRetryAfterMs;
    const requestId = candidate.requestId;
    const offloadImages = candidate.offloadImages;
    if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
    return Object.freeze({
      message,
      code,
      ...status === void 0 ? {} : { status },
      ...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
      ...requestId === void 0 ? {} : { requestId },
      ...offloadImages === void 0 ? {} : { offloadImages }
    });
  } catch (_sdkFailureGetter) {
    return;
  }
}
function errorMessage(error) {
  try {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch (_sdkMessageGetter) {
  }
  return "LLM adapter failed";
}
function harnessErrorCode(error) {
  return error instanceof HarnessError ? error.code : "UNKNOWN";
}
function quoted(value) {
  return JSON.stringify(value);
}
function textOnlyImageText(ref) {
  return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
function contentHasImage(content) {
  return content.some((block) => block.type === "image");
}
function contentHasFile(content) {
  for (const block of content) if (block.type === "file") return true;
  return false;
}
function fileHandleText(ref, readonlyPath) {
  const digest = String(ref.attachmentId).slice(7, 15);
  const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
  if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
  return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
function replaceFilesWithHandles(blocks, resolvePath) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "file") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: fileHandleText(block.attachment, resolvePath(block.attachment))
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
  if (!messages.some((message) => contentHasFile(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceFilesWithHandles(message.content, resolvePath);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function replaceImagesForTextModel(blocks) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "image") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: textOnlyImageText(block.attachment)
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectImagesForTextModel(messages) {
  if (!messages.some((message) => contentHasImage(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function withoutDeveloperMessages(messages) {
  const retained = messages.filter((message) => message.role !== "developer");
  return retained.length === messages.length ? messages : retained;
}
function toolDeclarations(tools, mode, history) {
  const declarations = new Map(history.tools.map((tool) => [tool.name, tool]));
  for (const update of history.updates) for (const tool of update.additions) if (!declarations.has(tool.name)) declarations.set(tool.name, {
    ...tool,
    deferLoading: true
  });
  switch (mode) {
    case "in-history":
      return declarations;
    case "addition-only": {
      const activeNames = new Set(tools?.map((tool) => tool.name));
      for (const name2 of declarations.keys()) if (!activeNames.has(name2)) declarations.delete(name2);
      return declarations;
    }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(mode);
  }
}
function projectToolUpdates(messages, tools, toolUpdate, history) {
  if (toolUpdate === void 0) {
    let immediateTools = tools;
    if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
    return {
      messages: withoutDeveloperMessages(messages),
      tools: immediateTools
    };
  }
  if (history === void 0) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const messageIds = new Set(messages.flatMap((message) => message.role === "developer" ? [message.id] : []));
  if (history.updates.some((update) => !messageIds.has(update.messageId))) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const declarations = toolDeclarations(tools, toolUpdate, history);
  const updateIds = new Set(history.updates.map((update) => update.messageId));
  const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
  const projectedMessages = [];
  for (const message of messages) {
    if (message.role !== "developer") {
      projectedMessages.push(message);
      continue;
    }
    if (!updateIds.has(message.id)) continue;
    const content = message.content.filter((block) => {
      switch (block.type) {
        case "tool-addition":
          if (!declarations.has(block.toolName) || offered.has(block.toolName)) return false;
          offered.add(block.toolName);
          return true;
        case "tool-removal":
          if (toolUpdate !== "in-history") return false;
          return offered.delete(block.toolName);
        default:
          return true;
      }
    });
    if (content.length === 0) continue;
    if (content.length === message.content.length) projectedMessages.push(message);
    else projectedMessages.push({
      ...message,
      content
    });
  }
  return {
    messages: projectedMessages.length === messages.length && projectedMessages.every((message, index) => message === messages[index]) ? messages : projectedMessages,
    tools: [...declarations.values()]
  };
}
var { version } = createRequire(import.meta.url)("../package.json");
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? {
      get: descriptor.get,
      set: descriptor.set
    } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
    else descriptor[key] = _;
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var LlmError = class extends HarnessError {
  /** Serializable facts retained beside this live Error. */
  failure;
  /**
  * @param message - non-empty human-readable failure summary.
  * @param code - non-empty stable provider-neutral machine code.
  * @param options - optional cause and validated serializable provider facts.
  */
  constructor(message, code, options) {
    if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
    if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
    if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
    if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
    if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
    super(message, code, options);
    this.name = "LlmError";
    this.failure = Object.freeze({
      message,
      code,
      ...options?.status === void 0 ? {} : { status: options.status },
      ...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
      ...options?.requestId === void 0 ? {} : { requestId: options.requestId },
      ...options?.offloadImages === void 0 ? {} : { offloadImages: options.offloadImages }
    });
  }
};
var LlmRuntime = (() => {
  let _classSuper = TypertRemoteService;
  let _instanceExtraInitializers = [];
  let _listProviders_decorators;
  let _listConfigurableProviders_decorators;
  let _remoteDiscoverModels_decorators;
  return class LlmRuntime extends _classSuper {
    static {
      const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
      _listProviders_decorators = [Remote];
      _listConfigurableProviders_decorators = [Remote];
      _remoteDiscoverModels_decorators = [Remote("discoverModels")];
      __esDecorate(this, null, _listProviders_decorators, {
        kind: "method",
        name: "listProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listProviders" in obj,
          get: (obj) => obj.listProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _listConfigurableProviders_decorators, {
        kind: "method",
        name: "listConfigurableProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listConfigurableProviders" in obj,
          get: (obj) => obj.listConfigurableProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _remoteDiscoverModels_decorators, {
        kind: "method",
        name: "remoteDiscoverModels",
        static: false,
        private: false,
        access: {
          has: (obj) => "remoteDiscoverModels" in obj,
          get: (obj) => obj.remoteDiscoverModels
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      if (_metadata) Object.defineProperty(this, Symbol.metadata, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: _metadata
      });
    }
    adapters = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
    directory = /* @__PURE__ */ new Map();
    discoveries = /* @__PURE__ */ new Map();
    constructor(ctx) {
      super(ctx, "llm");
    }
    /** Notify topology observers without letting one broken listener veto the commit. */
    emitAdaptersUpdated() {
      for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
        const returned = listener();
        if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
          this.warnAdaptersListenerFailure(error);
        });
      } catch (error) {
        this.warnAdaptersListenerFailure(error);
      }
    }
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    warnAdaptersListenerFailure(error) {
      this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
      this.ctx.logger.warn(error);
    }
    /**
    * Register an adapter for the given provider routes. Throws `LlmError` with code
    * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
    * Disposed with the fiber.
    * @param providers - every provider route this adapter should serve.
    * @param adapter - the adapter that streams calls for those providers.
    * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
    */
    registerAdapter(providers, adapter) {
      const owned = /* @__PURE__ */ new Set();
      let released = false;
      const dispose = this.ctx.effect(function* () {
        if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
        this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
        yield () => {
          released = true;
          for (const provider of owned) this.adapters.delete(provider);
          owned.clear();
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerAdapter()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
        this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
      };
      return handle;
    }
    /**
    * Validate one candidate route set for `adapter`, treating routes this
    * registration already holds as available. Nothing is mutated: a rejected
    * candidate leaves the registry exactly as it was.
    */
    prepareRoutes(providers, adapter, owned) {
      const unique = /* @__PURE__ */ new Set();
      const registrations = [];
      for (const provider of providers) {
        if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
        if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
        const info = adapter.providerInfo(provider);
        if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
        unique.add(provider);
        const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
        registrations.push({
          adapter,
          provider: {
            id: info.id,
            name: info.name
          },
          retryPolicy
        });
      }
      return registrations;
    }
    /**
    * Swap this registration's routes for the prepared ones in one synchronous
    * section, so no observer can see the registry between the release and the
    * re-registration. The route set's one mutation point is also where
    * `llm/adapters-updated` is published, so a `replace` announces itself
    * exactly like a first registration.
    */
    commitRoutes(owned, registrations) {
      for (const provider of owned) this.adapters.delete(provider);
      owned.clear();
      for (const registration of registrations) {
        this.adapters.set(registration.provider.id, registration);
        owned.add(registration.provider.id);
      }
      this.emitAdaptersUpdated();
    }
    /**
    * Describe provider routes with a registered adapter.
    * @returns detached provider metadata in registration order.
    */
    listProviders() {
      return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
    }
    /**
    * Declare provider routes an adapter plugin can activate through
    * configuration. Registration is all-or-nothing: an empty list, invalid
    * entry, or a provider already declared by any registration throws
    * `LlmError` without registering the rest. Disposed with the fiber.
    * @param entries - every configurable provider this plugin owns.
    * @returns a handle that withdraws all of them, and can atomically replace them.
    */
    registerConfigurableProviders(entries) {
      let held = [];
      let disposed = false;
      const commit = (candidates) => {
        const detached = [];
        const own = new Set(held.map((entry) => entry.provider));
        for (const entry of candidates) {
          if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
          if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
          if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
          detached.push(detachDirectoryEntry(entry));
        }
        for (const entry of held) this.directory.delete(entry.provider);
        for (const entry of detached) this.directory.set(entry.provider, entry);
        held = detached;
        this.emitAdaptersUpdated();
      };
      const dispose = this.ctx.effect(function* () {
        if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
        commit(entries);
        yield () => {
          disposed = true;
          for (const entry of held) this.directory.delete(entry.provider);
          held = [];
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerConfigurableProviders()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
        commit(next);
      };
      return handle;
    }
    /**
    * List every declared configurable provider, registered or dormant.
    * @returns detached directory entries in declaration order.
    */
    listConfigurableProviders() {
      return [...this.directory.values()].map(detachDirectoryEntry);
    }
    /**
    * Offer to interrogate provider endpoints on behalf of the settings
    * namespace this plugin owns. The namespace is the key because that is what
    * a configuration surface already holds from the configurable-provider
    * directory, and because a provider being *added* has no route to name yet.
    * Disposed with the fiber.
    * @param settingsNs - the namespace whose profiles this discovery serves.
    * @param discover - interrogates one endpoint and must honor the supplied signal.
    * @returns the disposer that withdraws the offer.
    */
    registerModelDiscovery(settingsNs, discover) {
      const dispose = this.ctx.effect(function* () {
        if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
        if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
        this.discoveries.set(settingsNs, discover);
        yield () => {
          this.discoveries.delete(settingsNs);
        };
      }.bind(this), "llm.registerModelDiscovery()");
      return () => void dispose();
    }
    /**
    * Interrogate one provider endpoint for the models it advertises. The
    * request describes a draft, not a stored route, so nothing here reads or
    * writes settings or credentials — the caller owns both, and the reply is
    * candidate metadata a surface may offer for adoption.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - the endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation.
    * @returns the advertised models, deduplicated in endpoint order.
    */
    async discoverModels(settingsNs, request, signal) {
      const discover = this.discoveries.get(settingsNs);
      if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
      if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
      const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
      const seen = /* @__PURE__ */ new Set();
      const models = [];
      for (const model of discovered) {
        if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push({
          id: model.id,
          ...model.name === void 0 ? {} : { name: model.name },
          ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
          ...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
        });
      }
      return models;
    }
    /**
    * Remote adapter for one draft provider interrogation.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation supplied by the Remote carrier.
    * @returns advertised models in endpoint order.
    * @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
    */
    async remoteDiscoverModels(settingsNs, request, signal) {
      try {
        return await this.discoverModels(settingsNs, request, signal);
      } catch (error) {
        throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
          settingsNs,
          ...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
        }, { cause: error });
      }
    }
    /**
    * Resolve the retry policy captured when one provider route was registered.
    * @param provider - registered provider route to inspect.
    * @returns the provider-owned policy, with normal defaults already resolved.
    */
    providerRetryPolicy(provider) {
      return this.registration(provider).retryPolicy;
    }
    /**
    * Resolve provider-side request-image pricing for one exact route, or
    * `undefined` when the provider is unregistered or declares none. Unknown
    * providers degrade to `undefined` rather than throwing because callers
    * price durable history whose route may no longer be mounted.
    * @param provider - provider route named by a request header.
    * @param model - exact model id named by the same header.
    * @returns the owning adapter's image pricing for the route, when declared.
    */
    imageRequestPricing(provider, model) {
      return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
    }
    /**
    * Resolve the image projection for an exact registered model route.
    * @param provider - registered provider route.
    * @param model - exact model id.
    * @param image - normalized image reference.
    * @returns dimensions and byte target used by the adapter's request serializer.
    */
    imageRequestTarget(provider, model, image) {
      return this.registration(provider).adapter.imageRequestTarget(provider, model, image);
    }
    /**
    * Resolve the exact text one durable file occurrence contributes to every
    * provider request in the current execution environment.
    * @param ref - durable verbatim file reference from model history.
    * @returns the same deterministic handle text used at adapter dispatch.
    */
    fileRequestText(ref) {
      return fileHandleText(ref, this.fileReadPath(ref));
    }
    /** Detach typed adapter-owned modality metadata. */
    detachedModalities(modalities) {
      return modalities === void 0 ? void 0 : [...modalities];
    }
    /**
    * Discover models advertised by one registered provider. Catalog membership
    * does not constrain core routing. Catalog-driven entry points may restrict
    * selection and submission to the advertised models.
    * @param provider - registered provider route to inspect.
    * @returns detached model metadata in adapter-preferred order.
    */
    async listModels(provider) {
      const models = await this.registration(provider).adapter.listModels(provider);
      const seen = /* @__PURE__ */ new Set();
      return models.map((model) => {
        if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
        seen.add(model.id);
        const inputModalities = this.detachedModalities(model.inputModalities);
        return {
          provider: model.provider,
          id: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          ...inputModalities === void 0 ? {} : { inputModalities }
        };
      });
    }
    /**
    * Resolve and validate all metadata from the adapter that owns one exact
    * route. The result is detached from adapter-owned objects; catalog
    * membership remains advisory and does not control request routing.
    * @param provider - registered provider route to inspect.
    * @param model - exact model id passed to the adapter.
    * @param signal - optional cancellation for adapter-owned asynchronous lookup.
    * @returns exact model identity plus available context and reasoning metadata.
    */
    async resolveModelInfo(provider, model, signal) {
      return this.resolveModelInfoFor(this.registration(provider), model, signal);
    }
    async resolveModelInfoFor(registration, model, signal) {
      const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
      return this.normalizeModelInfo(registration, model, resolved);
    }
    /** Validate and detach one adapter-returned exact model result. */
    normalizeModelInfo(registration, model, resolved) {
      const provider = registration.provider.id;
      if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const context = resolved.context;
      if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
      const inputModalities = this.detachedModalities(resolved.inputModalities);
      const systemPromptUpdate = resolved.systemPromptUpdate;
      if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const toolUpdate = resolved.toolUpdate;
      if (toolUpdate !== void 0 && toolUpdate !== "in-history" && toolUpdate !== "addition-only") throw new LlmError(`adapter returned invalid tool update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const defaultMaxTokens = resolved.defaultMaxTokens;
      if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
      const info = {
        provider,
        id: model,
        name: resolved.name,
        ...resolved.description === void 0 ? {} : { description: resolved.description },
        ...inputModalities === void 0 ? {} : { inputModalities },
        ...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
        ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
        ...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate },
        ...resolved.toolUpdate === void 0 ? {} : { toolUpdate: resolved.toolUpdate }
      };
      const reasoning = resolved.reasoning;
      if (reasoning === void 0) return info;
      if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      const seen = /* @__PURE__ */ new Set();
      const efforts = reasoning.efforts.map((effort) => {
        if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
        seen.add(effort.id);
        return {
          id: effort.id,
          name: effort.name,
          ...effort.description === void 0 ? {} : { description: effort.description }
        };
      });
      if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      return {
        ...info,
        reasoning: {
          efforts,
          ...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
        }
      };
    }
    /**
    * Validate a conversation call config against its exact model capability and
    * materialize adapter-configured defaults. Unsupported explicit efforts
    * reject before provider I/O; no clamping or aliasing is performed. This
    * standalone query does not bind a later dispatch; use {@link prepareCall}
    * when logging and streaming must share one adapter registration.
    * @param config - provider/model route and optional request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @returns a detached config only when a default must be materialized.
    */
    async resolveCallConfig(config, signal) {
      return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
    }
    async resolveCallFor(registration, config, signal) {
      const info = await this.resolveModelInfoFor(registration, config.model, signal);
      return this.resolveCallWithInfo(config, info);
    }
    /** Validate request controls against one already-bound exact model result. */
    resolveCallWithInfo(config, info) {
      const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
        ...config,
        maxTokens: info.defaultMaxTokens
      } : config;
      const reasoning = info.reasoning;
      const requested = defaulted.reasoningEffort;
      let resolvedConfig = defaulted;
      if (reasoning === void 0) {
        if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
      } else {
        const effective = requested ?? reasoning.defaultEffort;
        if (effective !== void 0) {
          if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
          if (requested !== effective) resolvedConfig = {
            ...defaulted,
            reasoningEffort: effective
          };
        }
      }
      return {
        config: resolvedConfig,
        ...info.context === void 0 ? {} : { context: info.context },
        modelInfo: info
      };
    }
    /**
    * Resolve one call under its current adapter registration. The returned
    * one-shot handle keeps that registration across header logging and dispatch,
    * so HMR cannot combine one adapter's capability result with another adapter.
    * An optional synchronous callback selects concrete controls using captured
    * model metadata. Defaults and validation apply to its result. Callback
    * failures and cancellation reject preparation before dispatch.
    * @param config - provider/model route and optional concrete request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @param configure - pure control selection, called once before defaults and validation.
    * @returns a prepared config and its registration-bound stream entry point.
    */
    async prepareCall(config, signal, configure) {
      signal?.throwIfAborted();
      const { provider, model, ...controls } = config;
      const registration = this.registration(provider);
      const adapterCall = await registration.adapter.prepareCall(provider, model, signal);
      signal?.throwIfAborted();
      const modelInfo = this.normalizeModelInfo(registration, model, adapterCall.model);
      const proposed = configure === void 0 ? config : {
        ...configure(deepFreeze(structuredClone(controls)), deepFreeze(modelInfo)),
        provider,
        model
      };
      signal?.throwIfAborted();
      const resolved = this.resolveCallWithInfo(proposed, modelInfo);
      const resolvedConfig = deepFreeze(structuredClone(resolved.config));
      const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
      const adapterDefaults = deepFreeze({
        ...proposed.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
        ...proposed.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
      });
      let dispatched = false;
      return Object.freeze({
        config: resolvedConfig,
        retryPolicy: registration.retryPolicy,
        adapterDefaults,
        ...context === void 0 ? {} : { context },
        ...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
        ...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
        ...modelInfo.toolUpdate === void 0 ? {} : { toolUpdate: modelInfo.toolUpdate },
        stream: (options) => {
          if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
          if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
          dispatched = true;
          return this.streamWithRegistration(options, {
            registration,
            config: resolvedConfig,
            modelInfo,
            dispatch: (options2) => adapterCall.stream(options2)
          });
        }
      });
    }
    registration(provider) {
      const registration = this.adapters.get(provider);
      if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
      return registration;
    }
    /** Remove replay state whose historical route is owned by another adapter. */
    forAdapter(options, adapter) {
      const messages = options.messages.map((message) => {
        if (message.role !== "assistant") return message;
        const source = message.source;
        if (source.replayState === void 0) return message;
        if (this.adapters.get(source.provider)?.adapter === adapter) return message;
        return freezeMessage({
          ...message,
          source: {
            kind: "model",
            provider: source.provider,
            model: source.model
          }
        });
      });
      if (messages.every((message, index) => message === options.messages[index])) return options;
      const filtered = {
        ...options,
        messages
      };
      return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
    }
    /**
    * Resolve the current execution-world read path of one durable file
    * reference through the mounted attachment and filesystem providers.
    */
    fileReadPath(ref) {
      let hostPath;
      try {
        hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
      } catch {
        return;
      }
      if (hostPath === void 0) return void 0;
      return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
    }
    /**
    * Final adapter boundary. Adapter selection, dispatch, iterator construction,
    * and iteration failures become one terminal failure chunk. Middleware and
    * downstream consumer failures remain thrown plugin or consumer errors.
    */
    async *adapterStream(options, prepared) {
      let iterator;
      try {
        const registration = prepared?.registration ?? this.registration(options.provider);
        const adapter = registration.adapter;
        let modelInfo;
        let resolvedConfig;
        let dispatch;
        if (prepared === void 0) {
          const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
          modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
          resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
          dispatch = (options2) => adapterCall.stream(options2);
        } else {
          modelInfo = prepared.modelInfo;
          resolvedConfig = prepared.config;
          dispatch = prepared.dispatch;
        }
        if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
        const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
          ...options,
          ...resolvedConfig
        }) : {
          ...options,
          ...resolvedConfig
        };
        let projectedMessages = resolvedOptions.messages;
        if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
        if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
        const projectedTools = projectToolUpdates(projectedMessages, resolvedOptions.tools, modelInfo.toolUpdate, resolvedOptions.toolHistory);
        projectedMessages = projectedTools.messages;
        let projectedOptions = resolvedOptions;
        if (projectedMessages !== resolvedOptions.messages || projectedTools.tools !== resolvedOptions.tools) {
          projectedOptions = {
            ...resolvedOptions,
            messages: projectedMessages,
            ...projectedTools.tools === void 0 ? {} : { tools: projectedTools.tools }
          };
          if (Object.isFrozen(resolvedOptions)) deepFreeze(projectedOptions);
        }
        iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
      } catch (error) {
        yield adapterFailureChunk(error, options.signal);
        return;
      }
      let completed = false;
      try {
        while (true) {
          let item;
          try {
            const next = await iterator.next();
            item = next.done ? { done: true } : {
              done: false,
              value: next.value
            };
          } catch (error) {
            completed = true;
            yield adapterFailureChunk(error, options.signal);
            return;
          }
          if (item.done) {
            completed = true;
            return;
          }
          yield item.value;
        }
      } finally {
        if (!completed) {
          const close = iterator.return?.bind(iterator);
          if (close) await close();
        }
      }
    }
    /**
    * Stream one model call as raw chunks (token-level deltas). Replay state is
    * retained only when the same adapter instance owns its historical provider
    * and the target provider. Final adapter selection remains fixed through
    * asynchronous exact-model resolution and dispatch. Adapter selection,
    * dispatch, and iteration failures become terminal `error` or `aborted`
    * finish chunks; middleware, nested-call, cleanup, and consumer failures
    * remain thrown.
    * @param options - the full request; `options.provider` selects the adapter.
    * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
    */
    stream(options) {
      return this.streamWithRegistration(options);
    }
    streamWithRegistration(options, prepared) {
      return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
    }
  };
})();
function adapterFailureChunk(error, signal) {
  const failure = normalizeLlmFailure(error);
  return {
    type: "finish",
    reason: signal?.aborted || failure.code === "ABORTED" ? {
      kind: "aborted",
      failure
    } : {
      kind: "error",
      failure
    }
  };
}
function detachDirectoryEntry(entry) {
  const { nativeAuth } = entry;
  return {
    ...entry,
    settingsPath: [...entry.settingsPath],
    ...entry.baseURLEnv === void 0 ? {} : { baseURLEnv: [...entry.baseURLEnv] },
    ...nativeAuth === void 0 ? {} : { nativeAuth: {
      ...nativeAuth,
      env: [...nativeAuth.env]
    } }
  };
}

// src/cmd/tool.ts
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  sandboxPermissionsDescription,
  validateEscalationArgs
} from "@deepseek-ai/dsh-sandbox";
import { DSH_ENV_PREFIX, parseExitStatus } from "@deepseek-ai/dsh-shell";
import { TOOL_ABORTED, defineTool } from "@deepseek-ai/dsh-tools";
import z3 from "@deepseek-ai/schemastery";
var name = "tool-cmd";
var inject = ["tools", "shell", "systemPrompt", "shellEnv", "workingDirectory"];
var Config2 = z3.object({
  enableRunInBackground: z3.boolean().default(true),
  promoteOnTimeout: z3.boolean().default(true)
});
function sandboxNotes(sandbox, escalationModes = []) {
  if (sandbox?.runnerFailed) {
    return [
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`
    ];
  }
  if (sandbox?.denied) {
    const notes = [sandboxDenialMarker(sandbox.mode)];
    if (escalationModes.length > 0) notes.push(escalationHintMarker("command"));
    return notes;
  }
  return [];
}
function processOutcome(proc, escalationModes = []) {
  const base = proc.status === "killed" ? {
    status: "killed",
    detail: proc.signal !== null ? `signal: ${proc.signal}` : "killed before exit"
  } : { status: "completed", detail: `exit code: ${proc.exitCode ?? 0}` };
  const notes = sandboxNotes(proc.sandbox, escalationModes);
  return notes.length === 0 ? base : { ...base, detail: `${base.detail}; ${notes.join(" ")}` };
}
function processSources(proc) {
  const source = (channel) => ({
    channel,
    read: (fromByte) => {
      const live = proc();
      return live === void 0 ? { text: "", nextOffset: fromByte, lossy: false } : live.observed[channel].readFrom(fromByte);
    }
  });
  return [source("stdout"), source("stderr")];
}
function ringDelta(chunks) {
  const out = chunks.filter((chunk) => chunk.channel !== "stderr").map((chunk) => chunk.text).join("");
  const err = chunks.filter((chunk) => chunk.channel === "stderr").map((chunk) => chunk.text).join("");
  const separator = out.length > 0 && !out.endsWith("\n") ? "\n" : "";
  return out + (err.length > 0 ? `${separator}[stderr]
${err}` : "");
}
function processJob(start, outcome) {
  const controller = new AbortController();
  let proc;
  return {
    cancel: (reason) => {
      if (controller.signal.aborted) return;
      controller.abort(reason);
      proc?.kill();
    },
    done: (async () => {
      try {
        proc = await start(controller.signal);
        try {
          if (controller.signal.aborted) proc.kill();
        } finally {
          await proc.done;
        }
        return outcome(proc);
      } catch (error) {
        return {
          status: controller.signal.aborted && proc === void 0 ? "killed" : "failed",
          detail: error instanceof Error ? error.message : String(error)
        };
      }
    })()
  };
}
function streamText(output) {
  if (!output.truncated) return output.text;
  return `${output.text}
[output truncated; full output: ${output.spillPath ?? "(unavailable)"}]`;
}
function renderResult(result, escalationModes = []) {
  const out = streamText(result.stdout);
  const err = streamText(result.stderr);
  let body = out;
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[stderr]
${err}`;
  }
  if (body.length === 0) body = "(no output)";
  const markers = [];
  if (result.sandbox?.denied) {
    markers.push(sandboxDenialMarker(result.sandbox.mode));
    if (escalationModes.length > 0) markers.push(escalationHintMarker("command"));
  }
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
  if (result.stopped !== void 0) markers.push(`[stopped: ${result.stopped}]`);
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`);
  else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`);
  if (markers.length === 0) return body;
  if (!body.endsWith("\n")) body += "\n";
  return body + markers.join("\n");
}
function renderPromoted(promoted) {
  return `${promoted.output.length > 0 ? promoted.output.endsWith("\n") ? promoted.output : `${promoted.output}
` : ""}[still running after ${promoted.timeoutMs}ms; moved to background job ${promoted.jobId}]
The command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.`;
}
function renderJobRead(delta, lossy, spillPaths, sandbox, escalationModes = []) {
  const notices = [];
  if (lossy) {
    notices.push(
      `[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(", ") : "(unavailable)"}]`
    );
  }
  if (sandbox?.runnerFailed) {
    notices.push(
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode \u2014 the command did not run; this is a sandbox problem, not a command failure]`
    );
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode));
    if (escalationModes.length > 0) notices.push(escalationHintMarker("command"));
  }
  if (notices.length === 0) return delta;
  return `${delta}${delta.length > 0 && !delta.endsWith("\n") ? "\n" : ""}${notices.join("\n")}`;
}
function validateCmdArgs(args, effectiveMode) {
  if (args.command.trim().length === 0) throw new Error("invalid command: expected a non-empty string");
  if (args.description.trim().length === 0) throw new Error("invalid description: expected a non-empty string");
  if (args.timeoutMs !== void 0 && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`);
  }
  if (args.sandbox_permissions !== void 0 && args.sandbox_permissions === effectiveMode) return;
  const justification = args.sandbox_permissions === void 0 && args.justification?.trim() === "" ? void 0 : args.justification;
  validateEscalationArgs(args.sandbox_permissions, justification);
}
function cmdDescription() {
  return [
    "Execute a Windows `cmd.exe` command and return its stdout/stderr.",
    "Each call runs in a fresh shell: no variable, directory or `setlocal` state survives between calls; pass `workdir` instead of using `cd`.",
    `Managed \`$${DSH_ENV_PREFIX}*\` variables expose current harness environment facts.`,
    "The command runs from a one-shot batch file, so batch syntax (`%VAR%`, `&`, `&&`, `||`, pipes, redirection, `( )` blocks, `if`, `for`, `call :label`, multi-line) behaves exactly as in a `.cmd` file. `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to that internal file and are not useful; use `%CD%` for the working directory.",
    "Command echoing is off for the whole call (`cmd.exe /q`) and is not restored, so the command lines themselves never appear in the output; only what the commands print is returned.",
    "Non-ASCII output requires the console code page to be UTF-8, which is the default; some legacy programs ignore it.",
    "Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.",
    "Provide `description` before `command` in the arguments.",
    "Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way."
  ].join(" ");
}
function presentCmdCall(args) {
  if (args.run_in_background === true) {
    return {
      card: "generic",
      title: args.command,
      kind: "execute",
      rawInput: args.command,
      content: [{ type: "text", text: args.description }]
    };
  }
  return {
    card: "terminal",
    title: args.command,
    description: args.description,
    ...args.workdir !== void 0 ? { cwd: args.workdir } : {}
  };
}
function presentCmdResult(args, result) {
  const block = result.content.length === 1 ? result.content[0] : void 0;
  if (block === void 0 || block.type !== "text") return void 0;
  const raw = block.text;
  const isBackground = typeof args === "object" && args !== null && args.run_in_background === true;
  const isPromoted = result.value?.kind === "promoted";
  if (isBackground || isPromoted || result.isError) {
    return {
      card: "generic",
      content: [{ type: "text", text: `\`\`\`console
${raw.replace(/\n+$/, "")}
\`\`\`` }]
    };
  }
  const { body, ...exit } = parseExitStatus(raw);
  return { card: "terminal", output: body, ...exit };
}
function resolveWorkdir(modelWorkdir, sessionCwd) {
  if (modelWorkdir === void 0) return sessionCwd;
  if (sessionCwd !== void 0 && !isAbsolute2(modelWorkdir)) return `${sessionCwd}${sep2}${modelWorkdir}`;
  return modelWorkdir;
}
function canonicalCmdResult(result, cwd) {
  const output = (stream) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== void 0 ? { spillPath: stream.spillPath } : {}
  });
  return {
    cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== void 0 ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== void 0 ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== void 0 ? { runnerFailed: result.sandbox.runnerFailed } : {}
      }
    } : {}
  };
}
function toolAborted() {
  const error = new HarnessError("tool call aborted", TOOL_ABORTED);
  error.name = "AbortError";
  return error;
}
var BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: "string", required: true, const: "background" },
  jobId: { type: "string", required: true },
  cwd: { type: "string", required: true }
};
function apply(ctx, config = {}) {
  const backgroundEnabled = config.enableRunInBackground ?? true;
  const promoteOnTimeout = (config.promoteOnTimeout ?? true) && backgroundEnabled;
  const defaultMode = ctx.shell.sandboxMode;
  const escalationModes = defaultMode === void 0 ? [] : ESCALATION_TARGETS;
  const sandboxPolicy = defaultMode === void 0 ? void 0 : ctx.get("sandboxPolicy");
  if (defaultMode !== void 0 && sandboxPolicy === void 0) {
    throw new Error("tool-cmd: the mounted cmd executor confines but ctx.sandboxPolicy is missing");
  }
  const resolveSandboxPolicy = (exec) => sandboxPolicy?.resolve(exec.agent === void 0 ? {} : { session: exec.agent.session });
  const approveCmdEscalation = async (mode, justification, exec, standingPolicy) => {
    if (escalationModes.length === 0) {
      throw new Error(
        "sandbox_permissions is not available in this composition (no sandboxing executor to escalate)"
      );
    }
    if (standingPolicy === void 0) {
      throw new Error("tool-cmd: sandbox escalation without a resolved standing policy");
    }
    const effectiveMode = standingPolicy.mode;
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: "command" },
      {
        approver: ctx.get("approval"),
        agent: exec.agent,
        callId: exec.callId,
        toolName: "cmd",
        signal: exec.signal
      }
    );
  };
  const cmdTool = (jobs) => {
    const background = jobs !== void 0;
    const promote = background && promoteOnTimeout;
    const startJob = (registry, args, exec, spec) => {
      let proc;
      let stopped;
      return {
        id: registry.start({
          kind: "cmd",
          label: args.command,
          toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
          ...exec.agent !== void 0 ? { owner: exec.agent.id } : {},
          output: processSources(() => proc),
          run: () => {
            const hooks = processJob(
              async (signal) => {
                proc = await ctx.shell.execute({ ...spec, signal });
                return proc;
              },
              (started) => processOutcome(started, escalationModes)
            );
            return {
              done: hooks.done,
              cancel: (reason) => {
                stopped = reason;
                hooks.cancel(reason);
              }
            };
          }
        }),
        process: () => proc,
        stopped: () => stopped
      };
    };
    const waitOnJob = async (registry, attached, exec, spec) => {
      const owner = exec.agent?.id;
      const timeoutMs = spec.timeoutMs;
      const stop = async (reason) => {
        registry.kill(attached.id, owner, reason);
        const settled = await registry.wait(attached.id, timeoutMs, owner);
        if (settled.status !== "running" && settled.status !== "stopping") {
          registry.remove(attached.id, owner);
        }
        return settled;
      };
      let view;
      try {
        view = await registry.wait(attached.id, timeoutMs, owner, exec.signal);
      } catch {
        await stop("tool call aborted");
        throw toolAborted();
      }
      if ((view.status === "running" || view.status === "stopping") && attached.process() === void 0) {
        await stop("timed out during preparation");
        return {
          kind: "foreground",
          cwd: spec.workdir,
          exitCode: null,
          signal: null,
          timedOut: true,
          aborted: false,
          timeoutMs,
          stdout: { text: "", truncated: false },
          stderr: { text: "", truncated: false },
          ...spec.sandboxPolicy !== void 0 ? { sandbox: { mode: spec.sandboxPolicy.mode, denied: false } } : {}
        };
      }
      if (view.status === "running" || view.status === "stopping") {
        const read2 = registry.read(attached.id, owner);
        return {
          kind: "promoted",
          cwd: spec.workdir,
          jobId: attached.id,
          timeoutMs,
          output: renderJobRead(
            ringDelta(read2.chunks),
            read2.lossy,
            read2.job.output.spillPaths ?? [],
            attached.process()?.sandbox,
            escalationModes
          )
        };
      }
      registry.remove(attached.id, owner);
      const proc = attached.process();
      if (proc === void 0) throw new Error(view.detail);
      const result = await proc.result();
      const stopped = attached.stopped();
      return {
        kind: "foreground",
        ...canonicalCmdResult(result, spec.workdir),
        ...stopped !== void 0 ? { stopped } : {}
      };
    };
    return defineTool({
      name: "cmd",
      description: cmdDescription(),
      parameters: {
        description: {
          type: "string",
          required: true,
          description: 'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "dir /b" \u2192 "List files in current directory"; "git status" \u2192 "Show working tree status"; "npm install" \u2192 "Install package dependencies".'
        },
        command: {
          type: "string",
          required: true,
          description: "The cmd.exe command to execute."
        },
        timeoutMs: {
          type: "number",
          description: promote ? "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed." : "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
        },
        workdir: {
          type: "string",
          description: "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
        },
        ...background ? {
          run_in_background: {
            type: "boolean",
            description: "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
          }
        } : {},
        ...escalationModes.length > 0 ? {
          sandbox_permissions: {
            type: "string",
            enum: [...escalationModes],
            description: sandboxPermissionsDescription("command")
          },
          justification: {
            type: "string",
            description: "Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access. Use the language of the user\u2019s current request."
          }
        } : {}
      },
      output: {
        schema: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              properties: BACKGROUND_OUTPUT_PROPERTIES
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "promoted" },
                cwd: { type: "string", required: true },
                jobId: { type: "string", required: true },
                timeoutMs: { type: "number", required: true },
                output: { type: "string", required: true }
              }
            },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", required: true, const: "foreground" },
                cwd: { type: "string", required: true },
                exitCode: { required: true, oneOf: [{ type: "integer" }, { type: "null" }] },
                signal: { required: true, oneOf: [{ type: "string" }, { type: "null" }] },
                timedOut: { type: "boolean", required: true },
                aborted: { type: "boolean", required: true },
                stopped: { type: "string" },
                timeoutMs: { type: "number", required: true },
                stdout: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                stderr: {
                  type: "object",
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: "string", required: true },
                    truncated: { type: "boolean", required: true },
                    spillPath: { type: "string" }
                  }
                },
                sandbox: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    mode: { type: "string", required: true },
                    denied: { type: "boolean", required: true },
                    enforcement: { type: "string" },
                    runnerFailed: { type: "boolean" }
                  }
                }
              }
            }
          ]
        },
        render: (_args, value) => [
          {
            type: "text",
            text: value.kind === "background" ? `started background job ${value.jobId}` : value.kind === "promoted" ? renderPromoted(value) : renderResult(value, escalationModes)
          }
        ],
        presentationMeta: (_args, value) => ({ cwd: value.cwd })
      },
      async execute(args, exec) {
        const standingPolicy = resolveSandboxPolicy(exec);
        validateCmdArgs(args, standingPolicy?.mode);
        const approvedMode = args.sandbox_permissions !== void 0 && args.justification !== void 0 ? await approveCmdEscalation(
          args.sandbox_permissions,
          args.justification,
          exec,
          standingPolicy
        ) : void 0;
        const policy = approvedMode === void 0 || standingPolicy === void 0 ? standingPolicy : { ...standingPolicy, mode: approvedMode };
        const cwd = exec.agent === void 0 ? void 0 : await ctx.workingDirectory.ensure(exec.agent, exec.signal);
        const workdir = resolveWorkdir(args.workdir, cwd);
        const request = {
          command: args.command,
          ...workdir !== void 0 ? { workdir } : {},
          ...args.timeoutMs !== void 0 ? { timeoutMs: args.timeoutMs } : {},
          dshEnv: ctx.shellEnv.collect(exec),
          ...policy !== void 0 ? { sandboxPolicy: policy } : {}
        };
        if (args.run_in_background === true) {
          if (!backgroundEnabled) {
            throw new Error(
              "run_in_background is disabled for this deployment (enableRunInBackground: false)"
            );
          }
          if (jobs === void 0) {
            throw new Error(
              "background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs"
            );
          }
          if (exec.signal.aborted) throw toolAborted();
          const spec2 = ctx.shell.resolve({ ...request, onExpiry: "none" });
          const started = {
            kind: "background",
            jobId: startJob(jobs, args, exec, spec2).id,
            cwd: spec2.workdir
          };
          return started;
        }
        if (jobs !== void 0 && promote) {
          const spec2 = ctx.shell.resolve({ ...request, onExpiry: "none" });
          let attached;
          try {
            attached = startJob(jobs, args, exec, spec2);
          } catch (error) {
            ctx.logger.warn(
              `cmd: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`
            );
          }
          if (attached !== void 0) return waitOnJob(jobs, attached, exec, spec2);
        }
        const spec = ctx.shell.resolve({ ...request, signal: exec.signal });
        const result = await (await ctx.shell.execute(spec)).result();
        if (result.aborted) throw toolAborted();
        const foreground = {
          kind: "foreground",
          ...canonicalCmdResult(result, spec.workdir)
        };
        return foreground;
      },
      presentCall: presentCmdCall,
      presentResult: presentCmdResult
    });
  };
  if (!backgroundEnabled) {
    ctx.tools.register(cmdTool(void 0));
    return;
  }
  let foregroundOnly = ctx.get("jobs") === void 0 ? ctx.tools.register(cmdTool(void 0)) : void 0;
  ctx.inject(["jobs"], (jobCtx) => {
    foregroundOnly?.();
    foregroundOnly = void 0;
    const unregister = ctx.tools.register(cmdTool(jobCtx.jobs));
    jobCtx.effect(() => () => {
      unregister();
      if (ctx.fiber.state === 2) foregroundOnly = ctx.tools.register(cmdTool(void 0));
    });
  });
}

// src/preset.ts
import { JSON_SCHEMA, Type, dump, load } from "js-yaml";
var VARIANT_ID = "minimal-gitbash";
var MINIMAL_ID = "minimal";
var SOURCE_ID = MINIMAL_ID;
var BACKEND_TYPE = "gitbash";
var PTY_ROW_ID = "gitbash-pty";
var PTY_ROW_NAME = "dsh-terminal-shell/pty";
var JsExpr = new Type("tag:yaml.org,2002:js", {
  kind: "scalar",
  resolve: (data) => typeof data === "string",
  construct: (data) => ({ __jsExpr: data }),
  predicate: (value) => value instanceof Object && "__jsExpr" in value,
  represent: (data) => String(data.__jsExpr)
});
var entryListSchema = JSON_SCHEMA.extend(JsExpr);
var VARIANT_NAME = "\u6781\u7B80\u6A21\u5F0F \xB7 Git Bash";
var VARIANT_DESCRIPTION = "minimal \u9884\u8BBE\u7684\u6301\u4E45 Git Bash \u7248\u672C\uFF1A\u4E00\u4E2A bash \u5DE5\u5177\uFF0C\u8DE8\u8C03\u7528\u4FDD\u6301\u72B6\u6001\u3002";
function cloneMinimalForGitBash(rows, spec) {
  const variant = structuredClone(rows);
  const shell = variant.find((row) => row["id"] === "persistent-shell");
  if (shell === void 0) throw new Error("minimal preset has no persistent-shell group");
  if (!Array.isArray(shell["config"])) throw new Error("persistent-shell has no row list");
  const inner = shell["config"];
  shell["config"] = inner.filter((row) => row["id"] !== "terminal-pwsh" && row["id"] !== "persistent-pwsh");
  const bash = shell["config"].find((row) => row["id"] === "persistent-bash");
  if (bash === void 0) throw new Error("minimal preset has no persistent-bash tool");
  delete bash["disabled"];
  bash["config"] = { ...bash["config"], backendType: BACKEND_TYPE };
  const anchor = shell["config"].findIndex((row) => row["id"] === "pty");
  if (anchor < 0) throw new Error("minimal preset has no pty row");
  shell["config"].splice(anchor + 1, 0, {
    id: PTY_ROW_ID,
    name: PTY_ROW_NAME,
    config: {
      backendType: BACKEND_TYPE,
      bashPath: spec.bashPath,
      confinedPolicy: spec.confinedPolicy,
      loginShell: spec.loginShell,
      pythonUtf8: spec.pythonUtf8
    }
  });
  return variant;
}
function parsePresetRows(yamlText) {
  const parsed = load(yamlText, { schema: entryListSchema });
  if (!Array.isArray(parsed)) throw new Error("preset document is not a row list");
  return parsed;
}
function formatPresetRows(rows) {
  return dump(rows, { schema: entryListSchema, noRefs: true, lineWidth: -1 });
}
function service(ctx, name2) {
  try {
    return ctx.get(name2);
  } catch {
    return void 0;
  }
}
function countReferences(ctx) {
  let live = 0;
  const sessions = service(ctx, "sessions");
  if (sessions !== void 0) {
    const projections = service(ctx, "sessionProjections");
    for (const session of sessions.list()) {
      const projected = projections?.stateOf(session, "agentPreset");
      const preset = typeof projected === "string" ? projected : session.header?.agentPreset;
      if (preset === VARIANT_ID) live += 1;
    }
  }
  return live;
}
async function countPersistedReferences(ctx) {
  const query = service(
    ctx,
    "sessionQuery"
  );
  if (query === void 0) return 0;
  try {
    const records = await query.listSessions();
    return records.filter((record) => record.header?.agentPreset === VARIANT_ID).length;
  } catch (error) {
    writeDiagnostic(`variant: sessionQuery scan failed: ${messageOf(error)}`);
    return 0;
  }
}
function specSignature(spec) {
  return [spec.bashPath, spec.confinedPolicy, spec.loginShell ? "login" : "plain", spec.pythonUtf8 ? "utf8" : "raw"].join("|");
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function createVariantManager(ctx) {
  let current = { status: "absent", refs: 0 };
  let definition;
  let unregister;
  let signature;
  let inflight;
  let disposed = false;
  const view = () => ({
    status: current.status,
    id: VARIANT_ID,
    refs: current.refs,
    ...current.reason === void 0 ? {} : { reason: current.reason }
  });
  const set = (next) => {
    current = next;
    return view();
  };
  function presets() {
    return service(ctx, "agentPresets");
  }
  async function references() {
    return countReferences(ctx) + await countPersistedReferences(ctx);
  }
  async function register(spec) {
    const presetsService = presets();
    if (presetsService === void 0) {
      return set({ status: "failed", refs: 0, reason: "agentPresets service is not available" });
    }
    try {
      const document = await presetsService.readDocument(SOURCE_ID);
      const rows = cloneMinimalForGitBash(parsePresetRows(document.content), spec);
      definition = { id: VARIANT_ID, plugins: rows };
      unregister = await presetsService.register({
        id: VARIANT_ID,
        name: VARIANT_NAME,
        description: VARIANT_DESCRIPTION,
        order: 3.1,
        plugins: rows
      });
      writeDiagnostic(`variant: registered ${VARIANT_ID} bash=${spec.bashPath}`);
      return set({ status: "registered", refs: 0 });
    } catch (error) {
      const reason = messageOf(error);
      writeDiagnostic(`variant: registration failed: ${reason}`);
      unregister = void 0;
      definition = void 0;
      return set({ status: "failed", refs: 0, reason });
    }
  }
  async function unregisterVariant() {
    const drop = unregister;
    unregister = void 0;
    definition = void 0;
    signature = void 0;
    if (drop === void 0) return;
    try {
      await drop();
      writeDiagnostic(`variant: unregistered ${VARIANT_ID}`);
    } catch (error) {
      writeDiagnostic(`variant: unregister failed: ${messageOf(error)}`);
    }
  }
  async function converge(mode, spec) {
    const wanted = mode === "variant";
    const refs = await references();
    if (!wanted) {
      if (definition === void 0) return set({ status: "absent", refs });
      if (refs > 0) {
        return set({ status: "retained", refs });
      }
      await unregisterVariant();
      return set({ status: "absent", refs: 0 });
    }
    const resolved = await spec();
    if (resolved === void 0) {
      if (definition !== void 0) return set({ status: "registered", refs });
      return set({ status: "failed", refs: 0, reason: "Git Bash was not found" });
    }
    if (definition !== void 0) {
      if (signature === specSignature(resolved)) {
        const registered = unregister !== void 0;
        return set({ status: registered ? "registered" : "failed", refs });
      }
      writeDiagnostic("variant: inputs changed; rebuilding the definition");
      await unregisterVariant();
    }
    signature = specSignature(resolved);
    return register(resolved);
  }
  return {
    state: view,
    async verify() {
      if (definition === void 0) return view();
      const presetsService = presets();
      if (presetsService === void 0) return view();
      try {
        const roster = await presetsService.list();
        const entry = roster.find((row) => row.id === VARIANT_ID);
        if (entry?.broken !== void 0) {
          writeDiagnostic(`variant: mount failed: ${entry.broken}`);
          return set({ status: "failed", refs: current.refs, reason: entry.broken });
        }
      } catch (error) {
        writeDiagnostic(`variant: roster check failed: ${messageOf(error)}`);
      }
      return view();
    },
    async sync(mode, spec) {
      if (disposed) return view();
      if (inflight !== void 0) {
        await inflight.catch(() => void 0);
        if (disposed) return view();
      }
      const pass = converge(mode, spec).catch((error) => {
        writeDiagnostic(`variant: sync failed: ${messageOf(error)}`);
        return set({ status: "failed", refs: current.refs, reason: messageOf(error) });
      });
      inflight = pass;
      try {
        return await pass;
      } finally {
        if (inflight === pass) inflight = void 0;
      }
    },
    async release() {
      disposed = true;
      if (inflight !== void 0) await inflight.catch(() => void 0);
      await unregisterVariant();
      signature = void 0;
      current = { status: "absent", refs: 0 };
    }
  };
}
async function resolveVariantSpec(options) {
  if (options.bashPath.trim() !== "") {
    return {
      bashPath: options.bashPath.trim(),
      confinedPolicy: options.confinedPolicy,
      loginShell: options.loginShell,
      pythonUtf8: options.pythonUtf8
    };
  }
  const report = await discoverBash({
    bashPath: options.bashPath,
    bashCandidates: options.bashCandidates,
    autoDiscover: options.autoDiscover,
    timeoutMs: options.timeoutMs
  });
  if (report.found === void 0) return void 0;
  return {
    bashPath: report.found.path,
    confinedPolicy: options.confinedPolicy,
    loginShell: options.loginShell,
    pythonUtf8: options.pythonUtf8
  };
}

// src/replace.ts
var TOOL_PWSH_ORDER = 1010;
function optional(ctx, name2) {
  return ctx.get(name2);
}
function presetOf(agentCtx, agent) {
  const projections = optional(agentCtx, "sessionProjections");
  const projected = projections?.stateOf(agent.session, "agentPreset");
  if (typeof projected === "string") return projected;
  const header = agent.session.header;
  return header?.agentPreset;
}
async function installSession(ctx, agent, snapshot) {
  const id = String(agent.id);
  if (process.platform !== "win32") return { status: "skipped", reason: skip(id, "not-win32") };
  const agentCtx = agent.ctx;
  if (agentCtx === void 0) return { status: "skipped", reason: skip(id, "no-agent-context") };
  const preset = presetOf(agentCtx, agent);
  if (preset === VARIANT_ID) return { status: "skipped", reason: skip(id, "already-replaced") };
  if (preset === MINIMAL_ID && snapshot.minimalMode !== "oneshot") {
    return { status: "skipped", reason: skip(id, "minimal-left", snapshot.minimalMode) };
  }
  if (snapshot.dialect === "pwsh") return { status: "skipped", reason: skip(id, "dialect-pwsh") };
  if (snapshot.dialect === "cmd") return installCmdSession(agent, agentCtx, snapshot);
  const tools = optional(agentCtx, "tools");
  const systemPrompt = optional(agentCtx, "systemPrompt");
  if (tools === void 0) return { status: "skipped", reason: skip(id, "missing-service", "tools") };
  if (systemPrompt === void 0) {
    return { status: "skipped", reason: skip(id, "missing-service", "systemPrompt") };
  }
  if (tools.get("bash", agent) !== void 0) {
    return { status: "skipped", reason: skip(id, "already-replaced") };
  }
  const discovery = await discoverBash({
    bashPath: snapshot.bashPath,
    bashCandidates: snapshot.bashCandidates,
    autoDiscover: snapshot.autoDiscover,
    timeoutMs: snapshot.discoverTimeoutMs
  });
  const found = discovery.found;
  if (found === void 0) {
    const detail = discovery.rejected.length === 0 ? `no candidate found (${discovery.considered.length} considered)` : discovery.rejected.map((item) => `${item.path}: ${item.reason}`).join("; ");
    return { status: "skipped", reason: skip(id, "bash-not-found", detail) };
  }
  const installRoot = bashInstallRoot(found.path);
  const pathEntries = bashPathEntries(installRoot, snapshot.extraPath);
  const undo = [];
  const fibers = [];
  try {
    const shellCtx = agentCtx.isolate("shell");
    const executorHost = await shellCtx.plugin(GitBashExecutor, {
      ...executorConfig(snapshot),
      bashPath: found.path,
      pathEntries,
      loginShell: snapshot.loginShell,
      pythonUtf8: snapshot.pythonUtf8
    });
    fibers.push(executorHost);
    const toolHost = await shellCtx.plugin(ToolBash, {
      enableRunInBackground: true,
      promoteOnTimeout: true
    });
    fibers.push(toolHost);
    if (tools.get("bash", agent) === void 0) {
      throw new Error("tool-bash mounted but did not register a bash tool");
    }
    if (tools.get("pwsh", agent) !== void 0) {
      undo.push(tools.restrict({ deny: ["pwsh"] }));
      try {
        undo.push(
          systemPrompt.section({
            name: "tool:pwsh",
            order: systemPrompt.getSectionOrder("TOOL_PWSH") ?? TOOL_PWSH_ORDER,
            text: ""
          })
        );
      } catch (error) {
        warn(id, `cannot shadow the tool:pwsh prompt section: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warn(id, "no inherited pwsh tool to hide; leaving the inherited tool list alone");
    }
    agentCtx.effect(() => () => {
      for (const disposer of undo.reverse()) {
        try {
          disposer();
        } catch {
        }
      }
    });
    note(id, `bash=${found.path} source=${found.source} path=${pathEntries.length} entries`);
    return { status: "installed", bashPath: found.path };
  } catch (error) {
    for (const disposer of undo.reverse()) {
      try {
        disposer();
      } catch {
      }
    }
    for (const fiber of fibers.reverse()) {
      try {
        await fiber.dispose();
      } catch {
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "skipped", reason: skip(id, "mount-failed", detail) };
  }
}
async function installCmdSession(agent, agentCtx, snapshot) {
  const id = String(agent.id);
  const tools = optional(agentCtx, "tools");
  const systemPrompt = optional(agentCtx, "systemPrompt");
  if (tools === void 0) return { status: "skipped", reason: skip(id, "missing-service", "tools") };
  if (systemPrompt === void 0) {
    return { status: "skipped", reason: skip(id, "missing-service", "systemPrompt") };
  }
  if (tools.get("cmd", agent) !== void 0) {
    return { status: "skipped", reason: skip(id, "already-replaced") };
  }
  const found = discoverCmd(snapshot.cmdPath);
  if (found === void 0) {
    return {
      status: "skipped",
      reason: skip(id, "cmd-not-found", "no cmd.exe via cmdPath, ComSpec or %SystemRoot%")
    };
  }
  if (snapshot.cmdCodePage !== 65001) {
    warn(
      id,
      `cmdCodePage=${snapshot.cmdCodePage}: the harness decodes child output as UTF-8, so non-ASCII output will contain replacement characters`
    );
  }
  const undo = [];
  const fibers = [];
  try {
    const shellCtx = agentCtx.isolate("shell");
    const executorHost = await shellCtx.plugin(CmdExecutor, {
      ...executorConfig(snapshot),
      cmdPath: found.path,
      pathEntries: [...snapshot.extraPath],
      codePage: snapshot.cmdCodePage,
      pythonUtf8: snapshot.pythonUtf8,
      confinedPolicy: snapshot.cmdConfinedPolicy
    });
    fibers.push(executorHost);
    const toolHost = await shellCtx.plugin(tool_exports, {
      enableRunInBackground: true,
      promoteOnTimeout: true
    });
    fibers.push(toolHost);
    if (tools.get("cmd", agent) === void 0) {
      throw new Error("tool-cmd mounted but did not register a cmd tool");
    }
    const inherited = ["pwsh", "bash"].filter((name2) => tools.get(name2, agent) !== void 0);
    if (inherited.length > 0) {
      undo.push(tools.restrict({ deny: inherited }));
      for (const name2 of inherited) {
        const section = name2 === "pwsh" ? "tool:pwsh" : "tool:bash";
        try {
          undo.push(
            systemPrompt.section({
              name: section,
              order: systemPrompt.getSectionOrder(name2 === "pwsh" ? "TOOL_PWSH" : "TOOL_BASH"),
              text: ""
            })
          );
        } catch (error) {
          warn(
            id,
            `could not blank the ${section} prompt section: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } else {
      warn(id, "no inherited shell tool to hide; leaving the inherited tool list alone");
    }
    undo.push(
      systemPrompt.section({
        name: "tool:cmd",
        order: systemPrompt.getSectionOrder("TOOL_PWSH"),
        text: CMD_PROMPT_SECTION
      })
    );
    agentCtx.effect(() => () => {
      for (const disposer of undo.reverse()) {
        try {
          disposer();
        } catch {
        }
      }
    });
    note(
      id,
      `cmd=${found.path} source=${found.source} codepage=${snapshot.cmdCodePage} confined=${snapshot.cmdConfinedPolicy}`
    );
    return { status: "installed", bashPath: found.path, cmdPath: found.path };
  } catch (error) {
    for (const disposer of undo.reverse()) {
      try {
        disposer();
      } catch {
      }
    }
    for (const fiber of fibers.reverse()) {
      try {
        await fiber.dispose();
      } catch {
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "skipped", reason: skip(id, "cmd-mount-failed", detail) };
  }
}
export {
  CMD_PROMPT_SECTION,
  CmdExecutor,
  GitBashExecutor,
  MINIMAL_ID,
  MSYS_DENIAL_EXIT_CODES,
  MSYS_DENIAL_SIGNATURES,
  VARIANT_ID,
  cloneMinimalForGitBash,
  createVariantManager,
  diagnosticPath,
  discoverBash,
  discoverCmd,
  ensureScratchDir,
  formatPresetRows,
  installSession,
  isMsysStartupDenial,
  materializeCmd,
  parsePresetRows,
  planCmdLaunch,
  planLaunch,
  renderCmdScript,
  resolveVariantSpec,
  scriptArgv,
  snapshotConfig,
  sweepStaleScripts,
  writeDiagnostic
};
//# sourceMappingURL=testing.js.map
