# dsh-terminal-shell

English | [中文](README.zh.md)

On Windows, choose which shell sits behind the terminal tool the agent invokes: **PowerShell** (`pwsh`), the **local Git Bash** (`bash`), or **`cmd.exe`** (`cmd`).

## What this is
Every DSH platform ships exactly one terminal tool; on Windows that tool is PowerShell. This plugin adds a settings switch: pick bash or cmd, and every new session's tool catalog then contains that shell's tool while the other shell's tool disappears. Sessions already open stay as they are. Installing it changes nothing: the default `dialect: 'pwsh'` matches official behavior exactly.

Who needs it:

- You want a POSIX toolchain (git / ls / grep / sed / make / gcc) in front of the model — call `bash`;
- You want the system's own batch semantics on Windows — call `cmd`;

Design stance: **one switch, every preset follows, no preset file touched, the global `ctx.shell` never taken over**. Default `dialect: 'pwsh'`, so installing changes nothing; switch to `bash` or `cmd` and **new sessions** get the matching tool while the other shell tools vanish from that session's tool catalog — open sessions keep their original state. All config fields are `volatile` and snapshotted once at session creation — that is where "changes apply to new sessions only" comes from.

| Item | Value |
|---|---|
| Version | `0.2.1` |
| Platform | Windows (DSH Desktop / Web shell) |
| `engines.node` | `>=22` |
| `engines.dsh` | `>=0.2.1-rc.2 <0.3.0` |
| License | MIT |

> **Stopgap**: DSH has no built-in "terminal / shell selection" capability today. **Until the official capability lands, this plugin is its stopgap** — using the officially shipped executors and tools to swap the terminal of new Windows sessions; the `confinedPolicy` under the restricted sandbox tier is part of the same temporary wiring. **Once the official equivalent exists, this plugin can be disabled**: remove this row from the profile dependencies and restart, and new sessions return to the official terminal tool. The plugin does not modify the DSH install directory, does not modify any preset, and does not take over the global `ctx.shell`; its configuration is written only into the current profile's patch layer, so uninstalling needs no global cleanup. `minimalMode: variant` is an exception on this boundary but not a violation of it: the persistent-terminal edition is registered as a **new preset** `minimal-gitbash`, while the official `minimal` preset stays untouched; when no session references it any more, that preset vanishes on its own. See "Minimal mode" below.

---

## Why this plugin

DSH 0.2.1-rc.2's platform matrix is mutually exclusive on Windows — the bash family is switched off by `!!js` platform assertions:

```yaml
- id: bash-sandbox
  name: '@deepseek-ai/dsh-bash-sandbox'
  disabled: !!js process.platform === 'win32'
- id: pwsh-sandbox
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  disabled: !!js process.platform !== 'win32'
- id: tool-bash          # the same platform assertion
- id: tool-pwsh
```

At the same time `ctx.shell` is a **single-instance service** (loading a second one in the same context throws `service "shell" has been registered`), so on Windows there is simply no bash executor and no `bash` tool. There are only three routes to Git Bash:

| Route | Cost |
|---|---|
| Change the platform assertion in `dsh-base` / the profile patch | Touch first-party composition, restart, and it only affects that one plane |
| Write your own PTY / your own tool | Rewrite a 60KB+ tool contract, easy to drift from official behavior |
| **This plugin: per-session isolated replacement** | Inject the executor only into a new session's `isolate('shell')` subtree, leaving the host plane untouched |

This plugin takes the third route: it does not seize the global `ctx.shell`; it composes inside each **new session's** own local realm.

---

## Capabilities at a glance

All three dialects share one settings row and one config; only the tool, the executor and the transport differ:

| Dialect | Tool name | Executor | Transport | When to use |
|---|---|---|---|---|
| `pwsh` (default) | `pwsh` (official, kept as-is) | the platform's own pwsh executor | native | install the plugin but change no behavior |
| `bash` | `bash` (official `@deepseek-ai/dsh-tool-bash`) | `GitBashExecutor extends LocalBashExecutor` | `[bash.exe, -c, <command>]`, using the configured absolute path | when you need a POSIX toolchain (git / ls / grep / sed / make / gcc…) |
| `cmd` | `cmd` (own `src/cmd/tool.ts`, a verbatim port of the official `dsh-tool-bash`) | `CmdExecutor extends LocalBashExecutor` | writes a temporary `.cmd` script per call, `cmd.exe /d /q /c <bare script name>` | when you only have the system's `cmd.exe` and no Git Bash |

- Both `bash` / `cmd` hide `pwsh` from the replaced session's tool catalog (`cmd` also hides the inherited `bash`), and blank out the matching `tool:pwsh` prompt section.
- Timeouts, output collection and spill, abort classification, background jobs, `sandbox_permissions` escalation, session cwd, tool cards and exit-code markers are all inherited from or reuse the official implementation.
- `bash` reuses the official `@deepseek-ai/dsh-tool-bash`; because the official tool name and executor are both hard-wired to `bash`/`pwsh`, `cmd` uses a verbatim-ported standalone implementation (see [cmd dialect limitations](#cmd-dialect-limitations)).
- **Also lets the sidebar's interactive terminal use this machine's Git Bash.** A setting at the end of the bash block, 「侧边栏终端」 (`sidebarBash`), decides which `bash` the sidebar **New Terminal → Shell** menu launches. With 「本机 Git Bash」 the plugin resolves this machine's Git Bash at runtime (`discoverBash()`, no pinned path) and hands the core `terminal-controller` a single `config.shell` override in memory, so that menu's `bash` entry launches this profile's Git Bash (MINGW64/MSYS2) instead of WSL's `bash`. The label stays `bash` (never `bash.exe`). See [Coexisting with other plugins](#coexisting-with-other-plugins) for the footprint.

### How it works: per-session isolated replacement

The plugin implements no terminal itself; on `agent/created` it does four things to a new session (all reusing first-party components; `cmd` is the only exception, see the table above):

```
shellCtx = agentCtx.isolate('shell')                // this agent's private shell realm
shellCtx.plugin(GitBashExecutor, {...})             // visible only in this subtree
shellCtx.plugin(ToolBash, {...})                    // the registered bash lands in the agent's own tool layer
agentCtx.tools.restrict({ deny: ['pwsh'] })         // filters only INHERITED tools
agentCtx.systemPrompt.section({ name: 'tool:pwsh', text: '' })  // empty text = dropped at render
```

- **Never takes over the global `ctx.shell`**: a global replacement would change every session (including those that did not pick bash / cmd) and would collide with the host platform's executor.
- **`restrict` filters only the inherited layer**: the official semantics are "never what its OWN layer registers", so calling `restrict({deny:['pwsh']})` from the agent scope hides exactly the `pwsh` the preset brought in and does not touch the `bash` this layer registered; the `cmd` dialect calls `restrict({deny:['pwsh','bash']})` to hide both inherited tools (it first checks visibility with `tools.get`, since hiding a name that does not exist throws).
- All four steps are registered on `agentCtx` and released in reverse order by cordis when the session ends; a mid-way failure rolls back in reverse and the session degrades to its original state.
- **New sessions only**: tools and prompts are assembled at session creation and cannot be swapped at runtime — that is DSH's semantics, not a choice of this plugin.

---

## Install / enable

### Prerequisites

- **Windows platform**: the `cordis.patch.yml` row carries `disabled: !!js process.platform !== 'win32'`, so it is not loaded at all on other platforms.
- DSH Desktop `>=0.2.1-rc.2 <0.3.0` (`engines.dsh` in `package.json`).
- For the `bash` dialect: Git for Windows (or MSYS2 / Cygwin) installed locally.
- For the `cmd` dialect: only the system's own `cmd.exe` (`%ComSpec%`), nothing extra to install.

### Steps

```powershell
# 1. Build (artifacts land in lib/)
git clone https://github.com/road-kid/dsh-terminal-shell.git
cd dsh-terminal-shell
npm install
npm run check        # typecheck → build → contractcheck → clientsmoke → selftest → rowselftest → rendertest → cmdunit → integration → cmdtest → ptytests

# 2. Install into the profile (the local profile here is "desktop")
#    Install from a local directory with the plugin manager:
#    plugin_manager install_bundle → target = the absolute path of this repo
npm pack
# or put the tarball / directory into the profile's dependencies, e.g.
#   C:\Users\<you>\.dsh\profiles\desktop\package.json
```

The package ships its own `dsh.bundle.patch` (`dsh.bundle.patch = ./cordis.patch.yml` in `package.json`); the profile's composition layer reads it and inserts one row:

```yaml
# the plugin's own row (agent-tool dialect)
- insert:
    - id: terminal-shell
      name: dsh-terminal-shell
      disabled: !!js process.platform !== 'win32'
```

The patch inserts that single row and nothing else: no executable path is pinned in `cordis.patch.yml`, so the file is identical on every machine.

- **`dialect` defaults to `pwsh`**: install the plugin without switching the dialect and session behavior is identical to the official one.
- **You must restart DSH after install or upgrade**: a row inserted at runtime only enters the composition tree; the plugin's `apply` is not called.

### Enabling

After the restart, open **Settings → General**; a new **Terminal shell** row appears at the bottom (a `settings.general.item` row registered by the client half, id `terminal-shell`, order `60`, locale namespace `terminal-shell`):

```
Terminal shell                                          [cmd ▾]
The shell the agent's tool calls run in. Changes apply to new sessions only.
cmd.exe path                              [C:/WINDOWS/system32/cmd.exe]
Sandbox policy                                      [Request permission ▾]
Minimal mode                                        [One-shot cmd ▾]
Console code page                                           [65001]
```

(The sketch above is the row after selecting `cmd`; with the default `pwsh` only the first line shows.)

The actual settings row for the `bash` and `cmd` dialects:

![The settings row with the bash dialect](assets/settings-row-bash.png)

![The settings row with the cmd dialect](assets/settings-row-cmd.png)

---

## Usage

The row layout matches the official General-section settings rows: a left column with the title (14px/22px) plus one explanatory sentence per row (12px/18px), and a control on the right; a 24px column gap, 16px vertical padding, and a `.5px` bottom divider (`--dsw-alias-border-l2`, dropped only on the last row of the group). All colors come from `--dsw-alias-*` design variables and follow the theme. **Every row holds exactly three things: label + one sentence + control.**

### Copy (`src/client/locales.ts` is the single source of truth)

| Row (which dialect) | Copy / options | Field written |
|---|---|---|
| First row (all) | Title "Terminal shell"; description "The shell the agent's tool calls run in. Changes apply to new sessions only."; dropdown "Terminal kind", options are the lowercase program names `powershell` / `bash` / `cmd` | `dialect` |
| Path (`bash`) | "Git Bash path", placeholder "e.g. C:/Program Files/Git/bin/bash.exe"; when empty and unscanned, the hint "Choosing Git Bash scans this machine; you can also type the full path to bash.exe." | `bashPath` |
| Sandbox policy (`bash`) | "Sandbox policy", options `Bypass the sandbox` (`unconfined`) / `Request permission` (`escalate`) | `confinedPolicy` |
| Minimal mode (`bash`) | "Minimal mode", options `Keep pwsh` (`leave`) / `One-shot bash` (`oneshot`) / `Add a new preset` (`variant`) | `minimalMode` |
| Sidebar terminal (`bash`, last) | "Sidebar terminal", description "Which bash the sidebar New Terminal uses; the system default is the PATH bash (WSL on Windows).", options `System default` (`system`) / `Local Git Bash` (`gitbash`) | `sidebarBash` |
| Path (`cmd`) | "cmd.exe path", placeholder "e.g. C:/Windows/System32/cmd.exe" (no description, aligned with the bash path row) | `cmdPath` |
| Sandbox policy (`cmd`) | "Sandbox policy", the same two options as `bash`: `Bypass the sandbox` / `Request permission` | `cmdConfinedPolicy` |
| Minimal mode (`cmd`) | "Minimal mode", options `Keep pwsh` (`leave`) / `One-shot cmd` (`oneshot`) | `minimalMode` |
| Console code page (`cmd`) | "Console code page", default `65001`, numeric input | `cmdCodePage` |

- **Order**: `cmd` matches `bash` — path → sandbox policy → minimal mode (`cmd` adds one console-code-page row at the end); `bash` additionally ends with the **Sidebar terminal** row. The `bash`-only fields (`loginShell` / `extraPath` / `pythonUtf8` / the `bash` `confinedPolicy`) are hidden under `cmd`, and vice versa.
- **The dialect dropdown is an official dropdown trigger**, opening an official `Menu`, rendered the same way as every enumerated preference in the official section.

### Switching the dialect triggers a scan

Scanning is a consequence of "choosing a shell", not a separate action: **switching the dialect to `bash` / `cmd` triggers one scan**, and there is no standalone detect button.

- The path control defaults to the official `Input`, where you can type an executable's full path directly; **when a scan finds more than one hit, the input turns into the same kind of dropdown**, listing every usable path.
- While scanning, that spot shows "Scanning…"; a scan that finds nothing says so explicitly instead of clearing the input.
- **A path already chosen and still valid is never rewritten by a later scan**.
- The switch itself is exactly the moment most likely to hit a race (a dialect write may still be queued on the same revision), so a refused write or a failed scan request **retries once automatically** (120ms apart), and you no longer see "nothing found on the first switch, only on the second".
- **No scan and no config write on mount**: `/state` reads config only, so opening the settings is instantaneous; scanning happens only when switching to `bash` / `cmd`.

### The two sandbox-policy values, and why the defaults differ

Each dialect has its own sandbox field (`confinedPolicy` for `bash`, `cmdConfinedPolicy` for `cmd`), and the row shows only the one for the current dialect. Each takes exactly two values:

| Value (UI) | Behavior |
|---|---|
| `Bypass the sandbox` (`unconfined`) | Under the restricted Windows tier, **launch directly with normal privileges** without calling `ctx.sandbox.confine()`; the call succeeds at once, but the model's commands **are not constrained by the file sandbox** |
| `Request permission` (`escalate`) | Enter the sandbox the official way first; a `bash` MSYS launch failure is marked `denied`, the model gets the official escalation prompt and retries with `sandbox_permissions: danger-full-access`, approved by the host |

**The differing defaults are deliberate** (`bash` defaults to `unconfined`, `cmd` to `escalate`):

- **`bash` defaults to `unconfined`**: MSYS2 / Git Bash cannot start under a restricted Windows token — initializing its named shared memory is refused (`NtCreateDirectoryObject` fails → `0xC0000022`). With an `escalate` default every command would fail once before going through approval; a direct default is what lets it succeed on the first try.
- **`cmd` defaults to `escalate`**: `cmd.exe` starts fine under a restricted token (the official windows-acl sandbox backend's probe is itself `cmd /c exit 0`), so going through the real sandbox both constrains commands and does not fail.

**Tool declaration**: with `unconfined` the executor does not declare a restricted tier to the tool (`sandboxMode` returns `undefined`), so the model is not told "the command runs in a sandbox"; the result's `sandbox.mode` reports `danger-full-access`, which is the **actual** boundary of that call. With `escalate` it goes through `confine()`, and `mode` / `enforcement` keep the official values.

**Security implication**: `unconfined` is an explicit product choice — under the restricted Windows tier there is no usable Git Bash without it; it means commands the model runs through `bash` are not constrained by the file sandbox. When you need sandbox constraints, choose `escalate` (official approval). Approval is handled entirely by the first-party `dsh-tool-bash`; the plugin only classifies MSYS launch failures as `denied` and implements no approval itself.

### Minimal mode (`minimalMode`, only meaningful for `bash`)

The official `minimal` preset is the only factory preset with a persistent shell (persistent pwsh on Windows). Under the `bash` dialect a `minimal` session therefore needs a separate decision:

| Value (UI) | Meaning |
|---|---|
| `leave` (Keep pwsh) | The plugin does not touch the official minimal preset; its persistent pwsh terminal stays |
| `oneshot` (One-shot bash, default) | The `minimal` session switches to a one-shot bash tool (one-shot cmd under the `cmd` dialect); `bash` replaces, `pwsh` hides |
| `variant` (Add a new preset) | Additionally registers the `minimal-gitbash` preset (a persistent bash variant); the official `minimal` is left as-is. Removed automatically when no session references it |

- The `cmd` dialect offers only `leave` / `oneshot` — `cmd` has no persistent-terminal backend, so it offers no "Add a new preset".
- The `variant` edition's row embeds the Git Bash absolute path resolved **at the moment of registration**; changing `bashPath` afterwards (or `confinedPolicy` / `loginShell` / `pythonUtf8`) rebuilds the definition from the new input, while already-running variant sessions keep running the old one.
- **The variant is not automatic**: you must choose "极简模式 · Git Bash" once for each new session; when you turn the option off while sessions still reference `minimal-gitbash`, the definition is kept (`retained`) and shows the reference count — deleting it would make those sessions unopenable forever.

### Console code page (`cmdCodePage`)

A `cmd` session runs `chcp <codePage>>nul` before executing, defaulting to `65001` (UTF-8), the only value that lets non-ASCII output survive. Lowering the code page turns Chinese into replacement characters. The client strictly accepts positive integers only and falls back to `65001` on invalid input.

### Path discovery order

**Git Bash (`bash` dialect)**: when `bashPath` is empty and `autoDiscover` is true, it searches in the following order and stops at the first hit (`discoverBash`); the scanner `scanBashCandidates` uses the same order but **lists every** candidate:

1. An explicit `bashPath` (at session assembly an explicit path is the answer, no whole-machine scan)
2. Each entry in `bashCandidates` (expanded to `bin\bash.exe` / `usr\bin\bash.exe` / `bash.exe`)
3. The `InstallPath` under the registry key `HKLM\SOFTWARE\GitForWindows`
4. `%ProgramFiles%\Git`, `%ProgramFiles(x86)%\Git`, `%LocalAppData%\Programs\Git`
5. `%ProgramFiles%\MSYS2`, `%SystemDrive%\msys64`, `%LocalAppData%\MSYS2`
6. `%SystemDrive%\cygwin64`, `%SystemDrive%\cygwin`
7. Back-deriving from `git.exe` / `git.cmd` / `git.bat` on PATH (`<root>\bin\bash.exe`)

**WSL is hard-excluded**: `C:\Windows\System32\bash.exe` and `WindowsApps\bash.exe` are not Git Bash — handing them to the executor would give a different operating system and a different filesystem, so discovery rejects them outright and records the reason.

Discovery only probes the filesystem (`statSync`) plus one asynchronous `reg.exe query`; it **never spawns `bash --version`** — the host dispatches events serially inside `agent/created`, and a synchronous spawn would stall the whole process. One scan is bounded by `discoverTimeoutMs`.

**cmd.exe (`cmd` dialect)**: when `cmdPath` is empty it tries `cmdPath` → `%ComSpec%` (also `COMSPEC`) → `%SystemRoot%\System32\cmd.exe` (also `SYSTEMROOT` / `windir`) in turn. It **does not scan the disk** — `cmd.exe` has no second reasonable location. A `cmdPath` that is not `cmd.exe` is treated as unset. If all three miss, the session skips replacement (`reason=cmd-not-found`) and keeps the official `pwsh` tool.

### PATH assembly

At execution the child process PATH = `toolchain bin` (`ucrt64`/`mingw64`/`clang64`/`mingw32`) → `usr\bin` → `bin` → `usr\local\bin` → `extraPath` → **host PATH**.

The order is intentional: MSYS2's `git`/`ls`/`grep` must beat the same-named tools from the same source on Windows, while the host PATH must be kept or native commands like `node`/`python` would disappear. Dedup normalizes by "lowercase + strip trailing separator + `/`→`\`".

---

## cmd dialect limitations

`cmd` is the only dialect **not built on the official `dsh-tool-bash`** (`src/cmd/tool.ts` is a verbatim port of the official tool); the constraints below all come from `cmd.exe` and batch semantics, not from a choice of this plugin:

1. **One-shot batch**: every call is a brand-new temporary `.cmd` script, and `pause`, `set /p`, or any interactive prompt will hang until the timeout. The executor is non-interactive.
2. **Echo cannot be restored**: `cmd.exe /q` turns off command echo, so the command text never appears in the output — only what the command itself prints comes back; `@echo on` inside the script cannot override `/q`.
3. **`%~dp0` / `%0` / `%1`–`%9` / `%*` point at the plugin's internal script**, not the command line the caller wrote; use `%CD%` for the working directory.
4. **`%VAR%` expands by batch rules**: a `set` on the same line is not yet visible to a new variable on that line.
5. **Non-ASCII output depends on the console code page**: default `chcp 65001`, changeable via `cmdCodePage`; lowering it turns Chinese into replacement characters.
6. **`cmdPath` only accepts `cmd.exe`**: entering bash or another program is rejected by the client with a prompt (`row.cmdPath.invalid`), and discovery also judges it invalid via `isCmdExecutable`; leaving it empty falls back to `%ComSpec%` → `%SystemRoot%\System32\cmd.exe`.
7. **No persistent PTY**: the `cmd` dialect offers no persistent terminal, and the `minimal` preset's persistent shell is not replaced (`minimalMode` is only meaningful for `bash`).
8. **The sandbox-denied marker may be missing**: on Chinese Windows, `cmd`'s denial message is GBK Chinese, so the provider's English signatures do not match and `sandbox.denied` may be `false` — the sandbox still applies; the plugin does not fake this verdict.

Transport implementation detail (why a temporary `.cmd` script per call): `cmd.exe` cannot take the command as an argument the way `bash -c` does — single-element, multi-element, environment-variable and stdin forms all fail on quoting, `%PATH%` expansion or multi-line. So each execution writes a `cmd-<uuid>.cmd` into **each executor's own scratch directory** (`dsh-cmd-<pid>-<uuid>` under `os.tmpdir()`), of the form:

```bat
@echo off
chcp 65001>nul
cd /d "<working directory>" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)
<the command text from the model>
```

- **The `cd` guard is not decoration**: the script starts in the scratch directory, so if the working directory no longer exists, without the guard the command would run silently in the scratch directory and `exit 0`; UNC paths switch to `pushd`.
- **No trailing `exit /b %errorlevel%`**: a `cmd` script's exit code is already the last command's exit code; writing it explicitly would change the `0` of commands like `dir /nonexistent & echo recovered`.
- **The file name is passed to `cmd.exe` as a bare name, with `cwd` set to the script directory**: the only form that survives `&` `(` `)` `^` `,` `;` `%` appearing in the scratch path (the absolute-path form fails on all of these).
- The script is written as UTF-8 without BOM, CRLF; each executor reclaims its own scratch directory in `ctx.effect`, and `sweepStaleScripts()` clears anything left from more than 24 hours ago at plugin startup.

---

## Configuration reference

Every field is `.volatile()` and handed to the official `configForms` by the host; the settings row edits some of them directly, and the rest can still be written into the profile patch. The fields map one-to-one to `src/config.ts`:

| patch key | Type | Default | Meaning |
|---|---|---|---|
| `dialect` | `'pwsh' \| 'bash' \| 'cmd'` | `'pwsh'` | Terminal dialect; `pwsh` keeps behavior unchanged |
| `bashPath` | `string` | `''` | Explicit absolute path to `bash.exe`; empty = auto-discover |
| `bashCandidates` | `string[]` | `[]` | Extra discovery roots / explicit executables, tried before the built-in order; also stores the usable paths from the last scan |
| `autoDiscover` | `boolean` | `true` | Whether to auto-discover at session assembly when `bashPath` is empty |
| `discoverTimeoutMs` | `number` | `1500` | Upper bound for one discovery (filesystem stat only, no spawn) |
| `loginShell` | `boolean` | `false` | Pass `-l` to read the login profile |
| `extraPath` | `string[]` | `[]` | Directories appended to the child process PATH |
| `pythonUtf8` | `boolean` | `true` | Export `PYTHONIOENCODING=utf-8` |
| `confinedPolicy` | `'unconfined' \| 'escalate'` | `'unconfined'` | How `bash` behaves under the restricted tier |
| `cmdPath` | `string` | `''` | Explicit absolute path to `cmd.exe` (only `cmd.exe` accepted); empty = `%ComSpec%` → `%SystemRoot%\System32\cmd.exe` |
| `cmdCodePage` | `number` | `65001` | The code page for `chcp` in the script |
| `cmdConfinedPolicy` | `'escalate' \| 'unconfined'` | `'escalate'` | How `cmd` behaves under the restricted tier |
| `minimalMode` | `'leave' \| 'oneshot' \| 'variant'` | `'oneshot'` | How the official `minimal` preset is treated |
| `sidebarBash` | `'system' \| 'gitbash'` | `'system'` | Which `bash` the sidebar **New Terminal** menu launches; `gitbash` resolves this machine's Git Bash at runtime and overrides the core controller in memory, `system` leaves the stock PATH menu |
| `timeoutMs` | `number` | `120000` | Per-command timeout, inherited from the official bash executor |
| `maxTimeoutMs` | `number` | `600000` | Maximum allowed timeout |
| `maxOutputBytes` | `number` | `64000` | Foreground output cap |
| `maxSpillBytes` | `number` | `67108864` | Byte cap for spilling to a file (64 MiB) |
| `graceMs` | `number` | `3000` | Grace period before killing a process |

> Both `confinedPolicy` and `cmdConfinedPolicy` take **only** `unconfined` / `escalate` (0.2.1 removed `fail` from the schema; writing `fail` in the profile fails schema validation, see [troubleshooting](#diagnostics-and-troubleshooting)).

---

## Uninstall

1. Remove the `dsh-terminal-shell` row from the profile dependencies (the `terminal-shell` inserted by `cordis.patch.yml`).
2. **Restart DSH**; new sessions return to the official terminal tool.

- **No global residue**: the plugin writes no `ctx.shell`, touches no loaded preset, and writes nothing into the host install directory; the effect lands only on the session replaced at creation time.
- **The `variant` preset cleans itself up**: on uninstall the variant manager's `release()` unregisters the `minimal-gitbash` definition (with the plugin gone, the definition cannot stay); if sessions still reference it, it is kept under the `retained` semantics until nothing references it.
- Sessions **already opened** under Git Bash / cmd do not switch back to `pwsh` (tools and prompt sections are fixed at session creation).

---

## Diagnostics and troubleshooting

Diagnostic log (one line per session):

```
%TEMP%\dsh-terminal-shell.log
```

Override the path with the environment variable `DSH_TERMINAL_TOOL_DIAG_FILE`. Typical lines:

```
[2026-10-18T02:10:00.000Z] ok session=... bash=C:\Program Files\Git\bin\bash.exe source=registry path=4 entries
[2026-10-18T02:10:00.000Z] ok session=... cmd=C:\WINDOWS\system32\cmd.exe source=comspec codepage=65001 confined=escalate
[2026-10-18T02:10:00.000Z] skip session=... reason=bash-not-found: C:\Program Files\Git\bin\bash.exe: file does not exist
[2026-10-18T02:10:00.000Z] skip session=... reason=cmd-not-found: no cmd.exe via cmdPath, ComSpec or %SystemRoot%
[2026-10-18T02:10:00.000Z] skip session=... reason=already-replaced
```

`reason` values: `not-win32` / `dialect-pwsh` / `no-agent-context` / `already-replaced` / `bash-not-found` / `cmd-not-found` / `missing-service` / `minimal-left` / `mount-failed` / `cmd-script-failed` / `cmd-mount-failed`. `minimal-left` means the session uses the `minimal` preset with `minimalMode` set to `leave` / `variant`, and the plugin steps aside by design; `dialect-pwsh` means the dialect is `pwsh` (or the bash-path verdict inside a cmd session), and the plugin does not intervene.

Common symptoms and what to do:

| Symptom | Cause / action |
|---|---|
| **Changed the setting, nothing happened, "the tool catalog is still the old one"** | The tool catalog and prompt sections are **fixed at session creation**. The setting changes the patch-layer entry Config, which does not affect already-assembled sessions. Only a **new session** picks up the new value |
| **Still no new tool after a restart** | Sessions open before the restart (including restored old sessions) are not re-assembled and do not even get a log line. **Fully quit and restart the host, then create a new session** — do not retest inside an old session |
| **No line for that session in the log** | `agent/created` never fired for it — the session was created before the plugin. Same fix as above |
| **`bash-not-found`** | Try setting `bashPath` explicitly to `C:\Program Files\Git\bin\bash.exe` |
| **`cmd-not-found`** | Set `cmdPath` explicitly to `C:\WINDOWS\system32\cmd.exe` |
| **`mount-failed` / `cmd-mount-failed`** | `detail` holds cordis's original error (commonly a config validation error or a missing service) |
| **Startup fails with `confinedPolicy: fail` in the profile** | `fail` was removed from the schema in 0.2.1 and is **no longer valid**; change it to `unconfined` or `escalate` |
| **`cmdPath` filled with bash and rejected** | `cmdPath` only accepts `cmd.exe`; the client prompts and refuses to write. Use the full path to `cmd.exe` |

The plugin never lets its own problems fail session creation: `agent/created` is dispatched serially, so a throwing listener would make the agent registration fail, and the whole listener body is therefore defensive — any exception only goes to the log.

---

## Development

Directory layout:

```
src/index.ts      Plugin entry: apply / Config / agent events / capability probe
src/config.ts     schemastery Config (all volatile) + per-session snapshot
src/discover.ts   Git Bash auto-discovery (including the WSL exclusion)
src/paths.ts      Path arithmetic: install roots, PATH entries, validation, PATH composition
src/executor.ts   GitBashExecutor (extends LocalBashExecutor, with the sandbox branch)
src/confined.ts   Restricted-sandbox launch decision (planLaunch) and the MSYS launch-failure signatures
src/cmd/          cmd dialect: types.ts contract, script.ts temporary .cmd script transport,
                  discover.ts discovery, executor.ts (CmdExecutor + planCmdLaunch),
                  tool.ts (the cmd tool), prompt.ts prompt section
src/preset.ts     Preset variant management: clone the official minimal rows, register / unregister, refcount
src/pty.ts        dsh-terminal-shell/pty entry: register the gitbash-type persistent terminal backend
src/replace.ts    Per-session replacement + reverse rollback (the bash and cmd assembly paths)
src/sidebar.ts    Apply the sidebar New-Terminal bash choice to the core terminal-controller in memory
src/diag.ts       Diagnostic log
src/routes.ts     Two /api routes: /state and /discover (neither writes config)
src/shared/protocol.ts  Wire protocol shared by host/client (route paths, constants, view types)
src/client/       Client half: the "Terminal shell" row under Settings → General
                  index.ts registers settings.general.item; row.tsx the row component;
                  store.ts the state machine; api.ts data fetching; styles.ts layout only; locales.ts copy
src/testing.ts    Test-only second entry (not published)
```

### Scripts

```powershell
npm run typecheck     # tsc --noEmit (devDeps pin the real 0.2.1-rc.2 .d.ts)
npm run build         # esbuild → lib/index.js (host ESM) + lib/client.js (client half) + lib/pty.js (persistent terminal entry)
npm run check         # run all the tests below in order
```

- `npm run contractcheck` (**19**): all-volatile Config / patch rows / export surface / client load shape / bundle does not inline first-party / atom specifiers stay external.
- `npm run clientsmoke` (**8**): really executes `lib/client.js` — module load shape, react and atom external, apply registers the row, degrade with no `configForms`, late-service replacement, HMR idempotency.
- `npm run selftest` (**51**): paths, discovery, snapshot, restricted launch decision, `/api` route registration, preset row cloning and variant lifecycle.
- `npm run rowselftest` (**19**): row state machine — `/state` read, optimistic writes, scan-on-switch and retry, each kind of failure prompt.
- `npm run rendertest` (**21**): renders and clicks for real in jsdom, asserting by role/aria on the dropdown trigger, the menu items and the path Input (including the four cmd rows and the cmd minimal-mode two options; official atoms are stood in for by `scripts/primitives-double.mjs`).
- `npm run cmdunit` (**37**): cmd unit tests — script template, discovery, launch decision, including a real `cmd.exe` spawn.
- `npm run integration` (**13**): runs the full replacement flow on real first-party services.
- `npm run cmdtest` (**14**): cmd end-to-end matrix — transport, quoting, variables, multi-line, encoding, exit codes, cwd, timeout, sandbox, assembly.
- `npm run ptytests` (**3**): runs persistent Git Bash on a real ConPTY — registration, state kept across commands, escalate denial (skipped on non-Windows).

### Build notes

`build.mjs` uses esbuild to emit plain ESM. First-party `@deepseek-ai/*` packages stay **external** (the harness resolves them through the install scope; inlining would duplicate service classes and break the `instanceof` / identity checks cordis relies on); the client bundle keeps `react` and the official UI atoms external too (the page seeds them, and inlining a second copy would break hook identity and CSS-module class names). **esbuild defaults to `charset: 'ascii'`**, so Chinese strings in the bundle are written as `\uXXXX` escapes — still correct Chinese at runtime, just not visible as literals in the artifact. Type declarations are hand-written `.d.ts` (not via `tsc --emitDeclarationOnly`), to avoid dragging the whole first-party `.d.ts` graph into the package.

---

## Compatibility

- **Platform**: Windows only. The `cordis.patch.yml` row carries `disabled: !!js process.platform !== 'win32'`, so it is not loaded elsewhere.
- **Profile**: Desktop (Web shell). The settings row relies on the official UI-atoms module table (`PLATFORM_MODULES`) that the Web shell ships; the host-half replacement logic does not depend on that table.
- **`engines.node`**: `>=22`.
- **`engines.dsh`**: `>=0.2.1-rc.2 <0.3.0` (developed and verified within this range). Re-verify after a major host version change.
- **`@deepseek-ai/dsh-llm`** is a `peerDependency`, external at build time (first-party classes are not inlined).
- **With a persistent-terminal bundle (e.g. `@deepseek-ai/dsh-experimental-terminal-bundle`)**: this plugin's `pty` entry only registers the `gitbash` backend inside a given preset's own persistent-terminal group; the official bundle owns an independent `terminals` registry and `terminal_*` tools, the two never read or write each other's state, so they can coexist.

### Coexisting with other plugins

This plugin's footprint (all prefixed `terminal-shell` / `dsh-terminal-shell`; on conflict the first loader wins):

| Surface | Name |
|---|---|
| Settings row slot | `settings.general.item`, id `terminal-shell`, order `60` |
| locale namespace | `terminal-shell` |
| bundle row id | `terminal-shell` (inserted, `cordis.patch.yml`) |
| Host routes | `/api/dsh-terminal-shell/state`, `/api/dsh-terminal-shell/discover` |
| In-session tools | `bash` dialect: replaces `bash`, hides `pwsh`; `cmd` dialect: adds `cmd`, hides `pwsh` and `bash` (only in the replaced session) |

- **Writes no global state**: does not touch `ctx.shell`, touches no loaded preset, writes nothing into the host install directory, and pins no executable path in `cordis.patch.yml`. When `sidebarBash` is `gitbash` it hands the core `terminal-controller` an in-memory `config.shell` override (never persisted); `system` leaves that controller untouched.
- **Installed alongside another Git Bash plugin (e.g. `dsh-gitbash-shell`)**: both want to replace the session's `bash` tool. This plugin skips replacement when it finds a `bash` tool already in the same scope (`already-replaced`), but does **not** distinguish whether that `bash` came from this plugin. Install just one.
- **With UI plugins (sidebar / shortcuts, etc.)**: it occupies one settings row and one locale namespace; at runtime it may set the core `terminal-controller`'s `config.shell` in memory (only when `sidebarBash` is `gitbash`), but writes no other DOM or runtime global state. If another plugin also configures `terminal-controller`, whichever config object is live at spawn time wins.
- **Hot disable**: after disabling the plugin, sessions already assembled for Git Bash / cmd do not switch back to `pwsh`; new sessions return to the official terminal tool; the variant preset is unregistered along with the plugin.

---

## References

- [`docs/DESIGN.md`](docs/DESIGN.md): architecture and module design (capability list, decision rationale, deviations and open items, maintained alongside the code).
- [`docs/history/`](docs/history/README.md): archived historical planning and review (`PLAN-cmd-dialect.md`, `PLAN-confined-bash.md`, `PLAN-minimal-mode.md`, `REVIEW-cmd-dialect.md`). Note that their version numbers are the old numbering from before the renumbering — see "Version numbering" in `CHANGELOG.md`.
- [`CHANGELOG.md`](CHANGELOG.md): version history (the 0.2.1 section records this settings-row redesign, the `fail` removal and the `cmdPath` validation).
