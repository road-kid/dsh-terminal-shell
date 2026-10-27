import { statSync } from 'node:fs'
import { join } from 'node:path'

import type { CandidateView } from '../shared/protocol.ts'
import type { CmdLocation } from './types.ts'

/**
 * Resolve `cmd.exe`.
 *
 * Three deterministic steps instead of a filesystem sweep: every Windows install
 * exposes cmd through `ComSpec` or `%SystemRoot%`, so scanning would only add
 * latency and nondeterminism to session creation. Unlike the Git Bash path there
 * is no WSL-style impostor to filter out — `System32\cmd.exe` is the real thing,
 * and `cmd.exe` found on `PATH` is never preferred over these two because a
 * hijacked `PATH` entry would then decide which shell a session runs.
 */

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Whether `path` names a `cmd.exe` (case-insensitive, basename only).
 *
 * The `cmdPath` override exists so a user can point at a *copy* of Command
 * Prompt (another Windows installation, a redistributable); it must never
 * accept an arbitrary existing executable. Without this check a stale or
 * hand-edited config such as `cmdPath: C:\Program Files\Git\bin\bash.exe`
 * would make every `cmd` session launch Git Bash under a cmd-shaped contract.
 */
export function isCmdExecutable(path: string): boolean {
  const name = path.trim().replace(/[\\/]+$/, '')
  const base = name.slice(Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/')) + 1)
  return base.toLowerCase() === 'cmd.exe'
}

/**
 * Find the executable a session should use.
 *
 * @param configured - the `cmdPath` config value; empty means "discover".
 * @param env - environment to read `ComSpec`/`SystemRoot` from (tests pass a fake).
 * @returns the executable and where it came from, or `undefined` when this host
 *   has no usable `cmd.exe` (the caller then keeps the inherited shell tool).
 */
export function discoverCmd(configured: string, env: NodeJS.ProcessEnv = process.env): CmdLocation | undefined {
  const trimmed = configured.trim()
  // Only an actual cmd.exe may satisfy the override; anything else is ignored
  // so the deterministic ComSpec / System32 fallbacks below still win.
  if (trimmed !== '' && isCmdExecutable(trimmed) && isFile(trimmed)) return { path: trimmed, source: 'config' }

  const comspec = env.ComSpec ?? env.COMSPEC
  if (comspec !== undefined && comspec.trim() !== '' && isFile(comspec)) {
    return { path: comspec, source: 'comspec' }
  }

  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir
  if (systemRoot !== undefined && systemRoot.trim() !== '') {
    const path = join(systemRoot, 'System32', 'cmd.exe')
    if (isFile(path)) return { path, source: 'system-root' }
  }
  return undefined
}

/** Windows-insensitive comparison key for an executable path. */
function pathKey(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * List every `cmd.exe` a session could use, for the settings picker.
 *
 * Same three deterministic sources as {@link discoverCmd}, but returned as a
 * ranked list instead of the first hit, so the row can reuse the *same*
 * "dropdown when more than one, input otherwise" control it uses for Git Bash.
 * A configured path that does not exist is still listed (with `valid: false`) so
 * the row can explain it rather than silently dropping it; `discoverCmd` keeps
 * its own stricter "first valid" behaviour for session creation.
 *
 * @param configured - the `cmdPath` config value; empty means "not overridden".
 * @param env - environment to read `ComSpec`/`SystemRoot` from (tests pass a fake).
 */
export function scanCmdCandidates(configured: string, env: NodeJS.ProcessEnv = process.env): CandidateView[] {
  const out: CandidateView[] = []
  const push = (path: string | undefined, source: CandidateView['source']): void => {
    if (path === undefined) return
    const trimmed = path.trim()
    if (trimmed === '') return
    if (out.some((candidate) => pathKey(candidate.path) === pathKey(trimmed))) return
    // A configured path that is not cmd.exe is surfaced as invalid so the row
    // can explain it and the picker never offers it as a usable choice.
    const valid = isFile(trimmed) && (source !== 'configured' || isCmdExecutable(trimmed))
    out.push({ path: trimmed, source, valid })
  }

  push(configured, 'configured')
  push(env.ComSpec ?? env.COMSPEC, 'comspec')
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir
  push(systemRoot === undefined ? undefined : join(systemRoot, 'System32', 'cmd.exe'), 'system-root')
  return out
}
