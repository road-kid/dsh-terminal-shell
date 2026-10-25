/**
 * CMD dialect contracts.
 *
 * This module is the single place the four cmd modules agree on shapes. It has
 * no imports beyond type-only references to the sandbox package, so every other
 * `src/cmd/*` file can depend on it without creating a cycle:
 *
 * ```
 * types.ts  ← script.ts ← executor.ts
 *    ↑      ← discover.ts
 *    ↑      ← tool.ts
 * ```
 *
 * Everything here is a pure type (or a trivially pure constant): no node APIs,
 * no cordis, so the unit tests can import it in a bare process.
 */

import type { ConfinedSandboxMode, SandboxMode } from '@deepseek-ai/dsh-sandbox'

/**
 * How to launch `cmd.exe` when the standing sandbox policy is confined.
 *
 * Deliberately has **no `fail` member**, unlike `ConfinedPolicy` in
 * `src/confined.ts`: that type exists because Git Bash/MSYS2 cannot start under
 * a restricted token on Windows, so "refuse instead of silently unconfining"
 * was a real choice. `cmd.exe` starts fine under the same token — it is what the
 * official windows-acl backend uses as its own functional probe — so a cmd
 * launch can never be impossible for sandbox reasons.
 */
export type CmdConfinedPolicy = 'escalate' | 'unconfined'

/** Where a resolved `cmd.exe` came from, for diagnostics and tests. */
export type CmdSource = 'config' | 'comspec' | 'system-root'

/** One resolved `cmd.exe` plus where it was found. */
export interface CmdLocation {
  /** Absolute path to `cmd.exe`. */
  readonly path: string
  readonly source: CmdSource
}

/**
 * A materialized one-shot batch file.
 *
 * The transport is a real `.cmd` file rather than argv or an environment
 * variable: only a batch file preserves quoting, `%VAR%` expansion, multi-line
 * commands and `( )` blocks, and it keeps the command text off the `cmd.exe`
 * command line entirely (measured — see docs/probes/cmd-transport.mjs).
 */
export interface CmdScript {
  /** Absolute path to the `.cmd` file. */
  readonly path: string
  /** Delete the file now. Idempotent; never throws. */
  dispose(): void
}

/** What a script needs baked in at render time. */
export interface CmdScriptOptions {
  /**
   * Console code page the script switches to before running the command.
   * `65001` (UTF-8) by default; the escape hatch for a command that must see
   * the legacy ANSI page.
   */
  readonly codePage: number
  /**
   * The directory the command must run in.
   *
   * Required, not optional: the process is spawned from the scratch directory
   * and the script itself `cd`s here behind a guard. Making it optional would
   * let a caller forget it and get a command that silently runs in `%TEMP%`
   * (measured — docs/probes/cmd-cd-guard.mjs).
   */
  readonly workdir: string
}

/** How one `cmd.exe` launch is shaped. */
export type CmdLaunch =
  | { readonly kind: 'confine'; readonly mode: ConfinedSandboxMode }
  | { readonly kind: 'direct'; readonly mode: SandboxMode }
