import type { Context } from '@deepseek-ai/cordis'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import z from '@deepseek-ai/schemastery'

export declare const name = 'terminal-shell'
export declare const inject: string[]
export type RawConfig = BashLocalConfig & {
  readonly dialect: 'pwsh' | 'bash' | 'cmd'
  readonly bashPath: string
  readonly bashCandidates: readonly string[]
  readonly autoDiscover: boolean
  readonly discoverTimeoutMs: number
  readonly loginShell: boolean
  readonly extraPath: readonly string[]
  readonly pythonUtf8: boolean
  readonly confinedPolicy: 'unconfined' | 'escalate'
  readonly cmdPath: string
  readonly cmdCodePage: number
  readonly cmdConfinedPolicy: 'escalate' | 'unconfined'
  readonly minimalMode: 'leave' | 'oneshot' | 'variant'
  readonly sidebarBash: 'system' | 'gitbash'
}
export type SkipReason =
  | 'not-win32'
  | 'dialect-pwsh'
  | 'no-agent-context'
  | 'already-replaced'
  | 'bash-not-found'
  | 'missing-service'
  | 'minimal-left'
  | 'mount-failed'
  | 'dialect-cmd'
  | 'cmd-not-found'
  | 'cmd-script-failed'
  | 'cmd-mount-failed'
export type InstallResult =
  | {
      readonly status: 'installed'
      readonly bashPath: string
      /** Present only for the cmd dialect. */
      readonly cmdPath?: string
    }
  | { readonly status: 'skipped'; readonly reason: SkipReason; readonly detail?: string }
export declare const Config: z<RawConfig>
export declare function apply(ctx: Context, config: RawConfig): void
export declare function installResultFor(agentId: string): InstallResult | undefined
