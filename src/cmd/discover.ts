import { statSync } from 'node:fs'
import { join } from 'node:path'

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
 * Find the executable a session should use.
 *
 * @param configured - the `cmdPath` config value; empty means "discover".
 * @param env - environment to read `ComSpec`/`SystemRoot` from (tests pass a fake).
 * @returns the executable and where it came from, or `undefined` when this host
 *   has no usable `cmd.exe` (the caller then keeps the inherited shell tool).
 */
export function discoverCmd(configured: string, env: NodeJS.ProcessEnv = process.env): CmdLocation | undefined {
  const trimmed = configured.trim()
  if (trimmed !== '' && isFile(trimmed)) return { path: trimmed, source: 'config' }

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
