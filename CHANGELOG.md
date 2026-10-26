# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Version numbering

The project was renumbered once, before `0.2.0`, while the entire history was still
private: nothing had ever been tagged or published, so no external consumer ever saw
the old numbers. Every historical release is now a patch release of `0.1.x`, because
none of them were independently installable — each one depended on the previous to be
usable at all (a host half with no settings row, a settings row with no working
sandbox, and so on).

| Released as | Now known as | Theme |
|---|---|---|
| `0.1.0` | `0.1.0` | host half |
| `0.1.1` | `0.1.1` | installable from git |
| `0.2.0` | `0.1.2` | client half |
| `0.3.0` | `0.1.3` | settings row matches the official design |
| `0.4.0` | `0.1.4` | Git Bash under a confined sandbox mode |
| `0.4.1` | `0.1.5` | stop advertising a sandbox the executor bypasses |
| `0.5.0` | `0.1.6` | minimal mode and a persistent Git Bash preset |
| `0.5.1` | `0.1.7` | the persistent terminal under test |
| — | `0.2.0` | the `cmd.exe` dialect |

Design documents written before the renumber keep the numbers they were written with
(`docs/PLAN-minimal-mode.md` describes `0.5.0`/`0.5.1`, `docs/PLAN-confined-bash.md`
describes `0.4.0`, and `docs/PLAN-cmd-dialect.md` cites `0.4.1`/`0.5.1`); those are
historical records of what the versions were called at the time. Use the table above
to translate them. The first version actually published under the new numbering was
`0.1.7`; `0.2.0` is the `cmd.exe` dialect.

## [Unreleased]

## [0.2.0]

### Added

- **A third terminal dialect: `cmd.exe`.** `dialect` now accepts `cmd` alongside
  `pwsh` and `bash`. A `cmd` session gets a `cmd` tool, and `pwsh`/`bash` are hidden
  from it. This is the first dialect that is **not** built on
  `@deepseek-ai/dsh-tool-bash`: the tool itself (`src/cmd/tool.ts`) is a port of the
  official one, because the official tool is hard-wired to `bash`/`pwsh` and to their
  sandbox story. `cmd.exe` needs a different transport, a different launch decision,
  and a different prompt section.
- `cmdPath`, `cmdCodePage` (default `65001`), and `cmdConfinedPolicy`
  (`escalate` default, or `unconfined`) settings, plus three matching rows in the
  settings panel. Only the cmd dialect shows them; `bashPath` and friends stay hidden
  while `cmd` is selected.
- `src/cmd/script.ts`: the transport. Every call is materialised as a temporary
  `.cmd` script in a per-executor scratch directory, and `cmd.exe` is spawned with
  `['/d', '/q', '/c', <bare file name>]` and `cwd` set to that directory. Passing the
  command as an argument does not work: `cmd`'s own quoting rules mangle quotes,
  `%VAR%` expansion, and multi-line input. Running the script by bare name is also the
  only form that survives `&`, `(`, `)`, `^`, `,`, `;`, and `%` in the scratch path.
- `src/cmd/executor.ts`: `CmdExecutor extends LocalBashExecutor`, with its own
  `planCmdLaunch()` instead of reusing `planLaunch()`. The existing decision encodes
  "Git Bash cannot start under the restricted token on Windows", which is the opposite
  of `cmd.exe`: the official Windows sandbox's own capability probe is `cmd /c exit 0`.
- `src/cmd/discover.ts`: `cmdPath` → `%ComSpec%` → `%SystemRoot%\System32\cmd.exe`.
- `scripts/cmdunittest.mjs` (unit, spawns real `cmd.exe`) and `scripts/cmdtest.mjs`
  (end-to-end matrix), both wired into `npm run check`.

### Fixed

- The dialect gate in `installSession` ran before the preset guards, so a `minimal`
  session could have been given a cmd tool on top of its own persistent terminal.
  The gate now runs after `VARIANT_ID`/`MINIMAL_ID` have had their say.
- `installSession` reads `tools` and `systemPrompt` from `agent.ctx`. The cmd path
  briefly used the root context, where `tools.restrict()` throws
  (`a context-global restriction would mask every agent`) and where a prompt section
  would leak into every session.

### Notes

- `cmd` commands cannot be made interactive: each call is a fresh batch script, so
  `pause`, `set /p`, and any prompt will hang until the timeout.
- Command echoing is disabled for the whole call (`cmd.exe /q`) and is not restored.
- `%~dp0`, `%0`, and `%1`–`%9` resolve against the plugin's internal script, not the
  model's command.
- Non-ASCII output depends on the console code page; `cmdCodePage` is the escape hatch.
- **Testing discipline**: the tool catalog is finalized when a session is created, so a
  session opened before the plugin finished installing (or before the host restart that
  activates it) never gets the `cmd` tool and leaves no diagnostic line at all. Verify a
  fresh install by restarting the host completely and opening a **new** session; an old
  session cannot be re-tested. This cost a full misdiagnosis once — see
  `docs/DESIGN.md` §14.10.

## [0.1.7]

### Changed

- **Renamed to `dsh-terminal-shell`** (was `dsh-terminal-tool`). The rename covers
  every identifier, not just the package name: the npm package, the bundle row id
  (`terminal-shell`), the client slot id and locale namespace, the `./pty` entry id
  (`terminal-shell-pty`), the two `/api/dsh-terminal-shell/*` routes, the generated
  `minimal-gitbash` preset's `terminal-shell/pty` row name, and the diagnostic tag.
  Nothing had ever been published under the old name, so no external consumer is
  affected; an existing local install must be reinstalled under the new package name.

### Added

- `scripts/ptytests.mjs`: the `./pty` entry now runs against real ConPTY, terminal,
  subprocess, sandbox, and projection services. It proves that an `export` survives
  two sends and asserts that `fail` and `escalate` never degrade silently into an
  unsandboxed spawn.

### Fixed

- The `./pty` entry was missing the `sessionProjections` and `workingDirectory`
  injections, so the persistent terminal could not start.
- The sandbox policy was read once at `apply` time instead of per launch.

## [0.1.6]

### Added

- `minimalMode` setting with three values: `leave` (do not intervene), `oneshot`
  (the previous behaviour: one-shot Git Bash, `pwsh` hidden), and `variant` (register
  a cloned `minimal-gitbash` preset whose persistent terminal runs Git Bash).
- The `minimal-gitbash` preset variant, generated by a YAML round-trip of the **live**
  `minimal` document so locally edited presets still produce a working variant. The
  `./pty` entry reuses the official `BashTerminalBackend` PTY, handshake, and prompt
  handling, replacing only whether the terminal is confined.

### Changed

- Preset definitions are registered only after activation returns, because calling
  `agentPresets.list()` during activation deadlocks against the Host Loader.
- Uninstalling refuses to drop a preset definition that live sessions still
  reference; the state becomes `retained` and the reference count is shown.

## [0.1.5]

### Fixed

- `sandboxMode` returns `undefined` when the next launch would bypass the sandbox, so
  the tool no longer advertises a `sandbox_permissions` parameter that would not do
  anything.
- A bypassed launch reports `sandbox.mode = 'danger-full-access'`, which is the real
  boundary, and omits `enforcement`, which describes what an active backend can
  guarantee.
- The settings row stylesheet is injected when the module is materialised and owned by
  the loader, instead of being created inside a React effect that the loader could not
  reclaim.
- Route errors are translated sentences rather than a bare `HTTP 500`, and notices
  carry `role="status"`.

## [0.1.4]

### Added

- `confinedPolicy` setting with three values, decided by `planLaunch()`:
  - `unconfined` (default): launch directly, **without the file sandbox**.
  - `escalate`: try the official sandbox first, report the MSYS2 startup denial, and
    let the model retry through the official approval path.
  - `fail`: refuse to run and explain the configuration.

### Fixed

- Git Bash no longer dies before `argv` under the restricted token. MSYS2 cannot
  create `BaseNamedObjects` at low integrity
  (`NtCreateDirectoryObject 0xC0000022`, exit `-1073741502`); the policy now decides
  between a bypassed launch, the sandbox, and a hard failure, and MSYS startup denials
  are classified separately from runner failures.

## [0.1.3]

### Added

- Shared request/response types and two API routes: `POST /api/dsh-terminal-shell/state`
  resolves the current state without scanning, and `/discover` scans only when
  clicked. Opening the settings page is therefore instant.
- A DOM test that mounts the bundle under jsdom and clicks through it, so the JSX is
  actually executed rather than merely imported.

### Changed

- The settings row is built on the official UI atoms
  (`Button`/`Input`/`Menu`/`IconChevronDownOutlineRegular`) and matches the reference
  single-column group layout, instead of hand-rolled chips.

### Fixed

- A late `configForms` injection re-runs the row seater; the previous slot entry is now
  disposed first, so no read-only duplicate row stacks up. Repeated applies from HMR
  still short-circuit.

## [0.1.2]

### Added

- The client half (`src/client/*` plus a second build entry producing `lib/client.js`),
  registered into `settings.general.item`. The host half had exposed `dialect` as a
  volatile field, but nothing could render it: a settings row only exists when a client
  bundle claims the slot.

## [0.1.1]

### Fixed

- Git installs failed at `prepare`, because pnpm refuses to run lifecycle scripts of
  git dependencies (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`). The `prepare` script is
  gone, `prepack` is kept, and `lib/` is committed so an install resolves a ready
  bundle without building.

## [0.1.0]

### Added

- A switchable terminal tool for DSH on Windows. On Windows the host disables the whole
  bash family and composes only PowerShell, and `ctx.shell` is a single-instance
  service, so a second load throws.
- `GitBashExecutor extends LocalBashExecutor`, injecting a Git Bash executor into each
  new session's private shell subtree (`ctx.isolate('shell')`) and mounting the
  official `@deepseek-ai/dsh-tool-bash` over it. Only `argv()` and `resolve()` differ;
  sandboxing, output collection, and timeouts are inherited.
- `pwsh` is hidden with `tools.restrict({ deny: ['pwsh'] })` after confirming it is
  visible (restricting an unknown name throws), and its prompt section is blanked.
- Discovery of local Git Bash installs that deliberately excludes WSL, diagnostics
  written to `%TEMP%\dsh-terminal-shell.log`, and three test scripts.
