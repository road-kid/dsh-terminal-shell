import type { Context } from '@deepseek-ai/cordis'

import { discoverBash } from './discover.ts'
import { writeDiagnostic } from './diag.ts'
import type { ConfigSnapshot } from './config.ts'

/**
 * Sidebar New-Terminal bash selection.
 *
 * The interactive sidebar's "New Terminal" shell menu is the *core*
 * `terminal-controller`'s menu: `discoverShells()` builds it from
 * `config.shellCandidates`, where every entry is a bare name resolved on PATH.
 * On Windows the bare name `bash` reaches the WSL launcher in
 * `C:\Windows\System32` (it comes first on PATH), so the menu's `bash` entry is
 * WSL — not the Git Bash a Windows user expects.
 *
 * `terminal-controller` also accepts a single `config.shell` override
 * (`{ path, name, args }`); when set, discovery resolves *that* path first and
 * keeps `name` verbatim as the menu label. This module owns exactly that
 * override.
 *
 * ### No pinned path, no disk write
 *
 * The user asked for a feature that never pins an absolute executable path
 * (which would break on another machine) and never rewrites the profile. So:
 *
 * - the Git Bash path is resolved at runtime through the plugin's own
 *   `discoverBash()` sweep (registry / Program Files / PATH), the same one the
 *   agent tool uses — no literal anywhere in this package;
 * - the override is applied **in memory** on the live service. We deliberately
 *   do NOT go through `ctx.loader.update()`: that path calls the profile
 *   `Include.write()`, which serialises every row (including this override)
 *   back to the profile YAML — exactly the machine-specific pollution to avoid.
 *   Reassigning the live service's config object is transient: removing the
 *   plugin, or selecting `system`, restores the stock menu immediately.
 */

/** The subset of the `terminal-controller` service this module touches. */
interface TerminalControllerLike {
  config?: { shell?: unknown; [key: string]: unknown }
}

/** Label the menu shows for the override; `bash` (never `bash.exe`). */
const SIDEBAR_SHELL_NAME = 'bash'

/** Args the shell profile uses for bash-kind entries (`profile()` gives `['-i']`). */
const SIDEBAR_SHELL_ARGS = ['-i'] as const

/** Resolve the live `terminal-controller` service, if this host has one. */
function getController(ctx: Context): TerminalControllerLike | undefined {
  try {
    return (ctx.get('terminalController') as TerminalControllerLike | undefined) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Apply the current `sidebarBash` choice to the live terminal-controller.
 *
 * @param ctx - a context that can see `terminalController` (see `apply` in
 *   `src/index.ts`, which resolves it through `ctx.inject`).
 * @param snapshot - the plugin's snapshot; `sidebarBash` and the bash discovery
 *   inputs (`bashPath`/`bashCandidates`/`autoDiscover`/`discoverTimeoutMs`) are
 *   read from it.
 */
export async function applySidebarBash(ctx: Context, snapshot: ConfigSnapshot): Promise<void> {
  // The sidebar menu only differs on Windows; elsewhere leave the stock menu.
  if (process.platform !== 'win32') return

  const controller = getController(ctx)
  if (controller === undefined || controller.config === undefined) return

  try {
    if (snapshot.sidebarBash !== 'gitbash') {
      // `system`: leave the menu exactly as the core builds it. Only clear the
      // override when a previous run set one, so this is a cheap no-op otherwise.
      if ('shell' in controller.config && controller.config.shell !== undefined) {
        controller.config = { ...controller.config, shell: undefined }
        writeDiagnostic('sidebar bash: system (stock PATH menu)')
      }
      return
    }

    const report = await discoverBash({
      bashPath: snapshot.bashPath,
      bashCandidates: snapshot.bashCandidates,
      autoDiscover: snapshot.autoDiscover,
      timeoutMs: snapshot.discoverTimeoutMs,
      signal: AbortSignal.timeout(4000),
    })
    const found = report.found
    if (found === undefined) {
      // No Git Bash on this machine: fall back to the stock menu rather than
      // leave a dangling override that resolveShell would fail to launch.
      if (controller.config.shell !== undefined) {
        controller.config = { ...controller.config, shell: undefined }
      }
      writeDiagnostic('sidebar bash: gitbash requested but no Git Bash found; using stock menu')
      return
    }

    // Shallow-copy before reassigning so the loader's stored entry options
    // (a different reference) is never mutated: only the running service sees it.
    controller.config = {
      ...controller.config,
      shell: { path: found.path, name: SIDEBAR_SHELL_NAME, args: [...SIDEBAR_SHELL_ARGS] },
    }
    writeDiagnostic(`sidebar bash: gitbash ${found.path}`)
  } catch (error) {
    writeDiagnostic(`sidebar bash: failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
