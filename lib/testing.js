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
var preparedDirs = /* @__PURE__ */ new Set();
function writeDiagnostic(message) {
  const line = `[${stamp()}] ${message}
`;
  try {
    const path = diagnosticPath();
    const dir = dirname(path);
    if (!preparedDirs.has(dir)) {
      mkdirSync(dir, { recursive: true });
      preparedDirs.add(dir);
    }
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
import { HarnessError } from "@deepseek-ai/dsh-llm";
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
import z2 from "@deepseek-ai/schemastery";
var name = "tool-cmd";
var inject = ["tools", "shell", "systemPrompt", "shellEnv", "workingDirectory"];
var Config2 = z2.object({
  enableRunInBackground: z2.boolean().default(true),
  promoteOnTimeout: z2.boolean().default(true)
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
import { statSync as statSync5 } from "node:fs";
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
function isExecutableFile(path) {
  try {
    return statSync5(path).isFile();
  } catch {
    return false;
  }
}
async function resolveVariantSpec(options) {
  const configured = options.bashPath.trim();
  if (configured !== "" && isExecutableFile(configured)) {
    return {
      bashPath: configured,
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
var TOOL_BASH_ORDER = 1e3;
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
              order: systemPrompt.getSectionOrder(name2 === "pwsh" ? "TOOL_PWSH" : "TOOL_BASH") ?? (name2 === "pwsh" ? TOOL_PWSH_ORDER : TOOL_BASH_ORDER),
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
    try {
      undo.push(
        systemPrompt.section({
          name: "tool:cmd",
          order: systemPrompt.getSectionOrder("TOOL_PWSH") ?? TOOL_PWSH_ORDER,
          text: CMD_PROMPT_SECTION
        })
      );
    } catch (error) {
      warn(id, `cannot register the tool:cmd prompt section: ${error instanceof Error ? error.message : String(error)}`);
    }
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
