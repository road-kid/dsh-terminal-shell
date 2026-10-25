import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import type { CmdScript, CmdScriptOptions } from './types.ts'

/**
 * Transport for the `cmd` dialect.
 *
 * The model produces a command *string*, but the execution seam only carries
 * argv, and `CreateProcessW` re-quotes argv with `CommandLineToArgvW` rules that
 * cmd.exe does not use. Measured on Windows 11 / Node 24: every inline form
 * either double-escapes quotes or has `/s` strip them, the environment-variable
 * form refuses a second `%VAR%` expansion and truncates at the first newline,
 * and stdin turns into an interactive prompt.
 *
 * A one-shot `.cmd` file is the only transport that preserves the semantics
 * users and models expect from cmd: quotes stay literal, `%VAR%` expands,
 * multi-line and blocks work, and `exit /b N` reaches the process exit code.
 *
 * Files live in a per-executor scratch directory so that a crash leaves at most
 * one directory to sweep, and every execution gets its own file so concurrent
 * calls cannot interleave.
 */

/**
 * Prefix shared by scratch directories and script files, used by the sweeper.
 *
 * Exported so the unit test (and any future maintenance tool) can build the same
 * names instead of duplicating the literal.
 */
export const SCRATCH_PREFIX = 'dsh-cmd-'

const SCRIPT_PREFIX = 'cmd-'
const STALE_MS = 24 * 60 * 60 * 1000

/**
 * Normalize any line ending to CRLF.
 *
 * cmd parses LF-only files correctly (measured, including parenthesised blocks
 * and `for /l`), so this is not a functional requirement — it is here so that
 * scripts behave the same when a human opens them in Notepad or feeds them to an
 * old tool that assumes CRLF.
 */
function crlf(text: string): string {
  return text.replace(/\r\n?|\n/g, '\r\n')
}

/**
 * Escape a path for use inside a quoted batch line.
 *
 * `%` is the one character a quoted path cannot protect: batch expands `%NAME%`
 * before the quote is removed, so a literal percent has to be doubled. Every
 * other metacharacter (`&`, `(`, `)`, `^`, `,`, `;`, `!` with delayed expansion
 * off) is inert inside the quotes the template supplies.
 */
export function escapeBatchPath(path: string): string {
  return path.replace(/%/g, '%%')
}

/**
 * Render the batch file body.
 *
 * `@echo off` suppresses command tracing. `/q` on the command line already does
 * the same and *cannot* be undone by a later `echo on` inside the script, so the
 * transport lines can never be echoed back into the transcript.
 *
 * The `cd` is guarded. Without the guard a workdir that disappears between
 * validation and execution makes the command run in the scratch directory
 * instead — silently, and with full write access. Measured: the guard exits 1
 * and stops the script (docs/probes/cmd-cd-guard.mjs).
 *
 * No trailing `exit /b %errorlevel%`: cmd's direct form (`/c <file>`) exits with
 * the success flag of the last command, which is what every other shell does.
 * A trailing `exit /b` would switch to the ERRORLEVEL variable instead, so
 * `dir /nonexistent` followed by `echo recovered` would report 1 where bash
 * reports 0.
 */
export function renderCmdScript(command: string, options: CmdScriptOptions): string {
  const lines: string[] = ['@echo off', `chcp ${options.codePage}>nul`]
  // `pushd` handles UNC shares, which `cd /d` cannot enter.
  const verb = options.workdir.startsWith('\\\\') ? 'pushd' : 'cd /d'
  const target = escapeBatchPath(options.workdir)
  lines.push(`${verb} "${target}" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)`)
  lines.push(crlf(command))
  return `${lines.join('\r\n')}\r\n`
}

/**
 * Choose a scratch directory under the OS temp area.
 *
 * The directory name carries the pid so a later host can tell its own
 * directories from a dead host's.
 */
export function ensureScratchDir(root?: string): string {
  const dir = root ?? join(tmpdir(), `${SCRATCH_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Write one script and hand back a handle that deletes it. */
export function materializeCmd(dir: string, command: string, options: CmdScriptOptions): CmdScript {
  const path = join(dir, `${SCRIPT_PREFIX}${randomUUID()}.cmd`)
  // UTF-8 without BOM: a BOM turns the first token into `\uFEFF@echo` and the
  // echo suppression silently stops working.
  writeFileSync(path, renderCmdScript(command, options), 'utf8')
  let disposed = false
  return {
    path,
    dispose(): void {
      if (disposed) return
      disposed = true
      try {
        rmSync(path, { force: true })
      } catch {
        // A script that cannot be deleted is left for the sweeper.
      }
    },
  }
}

/**
 * Name to pass to `cmd.exe`, and the directory to spawn it in.
 *
 * The script is addressed by **bare file name**, never by absolute path, and
 * this is not a special case for `%` — it is the only form that works for every
 * scratch location. Measured on this host, the absolute form exits 1 whenever the
 * directory name contains `&`, `(`, `)`, `^`, `,`, `;` or a paired `%NAME%`:
 * cmd's `/c` quote-preservation rule only keeps the quotes when the quoted text
 * is a plain executable name, so a quoted *path* gets its quotes stripped and
 * the path is then split at the first metacharacter. The bare form succeeds for
 * every one of those, plus spaces and `!` (docs/probes/cmd-transport.mjs).
 *
 * `/s` is deliberately absent: with `/s`, cmd strips the outermost quote pair of
 * the remainder, which destroys the quotes libuv adds around a path containing
 * spaces (`%TEMP%\John Doe\...` → `'C:\Users\John' 不是内部或外部命令`).
 *
 * The consequence is that the process starts in the scratch directory, so the
 * batch file must enter the real working directory itself — which is exactly what
 * the guarded `cd` in {@link renderCmdScript} does.
 */
export function scriptArgv(cmdPath: string, script: CmdScript): { argv: string[]; cwd: string } {
  return { argv: [cmdPath, '/d', '/q', '/c', basename(script.path)], cwd: dirname(script.path) }
}

/** Remove scratch directories left behind by a host that died. Never throws. */
export function sweepStaleScripts(now = Date.now(), root = tmpdir()): number {
  let removed = 0
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (!entry.startsWith(SCRATCH_PREFIX)) continue
    const dir = join(root, entry)
    try {
      const info = statSync(dir)
      if (!info.isDirectory() || now - info.mtimeMs < STALE_MS) continue
      rmSync(dir, { recursive: true, force: true })
      removed += 1
    } catch {
      // Best effort: a locked directory is retried on the next load.
    }
  }
  return removed
}
