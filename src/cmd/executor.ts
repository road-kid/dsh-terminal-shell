import type { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as BashLocalConfig } from '@deepseek-ai/dsh-bash-local'
import {
  SandboxUnavailableError,
  classifyRunnerFailure as classifyRunnerFailureMatch,
  isRunnerSpawnFailure,
  matchesSignature,
} from '@deepseek-ai/dsh-sandbox'
import type {
  ConfinedArgv,
  RunnerFailureRule,
  SandboxMode,
  SandboxPolicy,
  SandboxProvider,
} from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type {
  ShellExecRequest,
  ShellExecSpec,
  ShellExecution,
  ShellProcess,
  ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import { rmSync, statSync } from 'node:fs'

import { composePath } from '../paths.ts'
import { ensureScratchDir, materializeCmd, scriptArgv } from './script.ts'
import type { CmdConfinedPolicy, CmdLaunch, CmdScript } from './types.ts'

/**
 * The `cmd` dialect executor.
 *
 * Subclassing `LocalBashExecutor` rather than writing a new executor keeps
 * everything this plugin must not diverge from: deadline arming, output
 * collection and spilling, abort classification, `dshEnv` merging and result
 * shaping all stay first-party. Only three things change — the argv built for
 * the command, the PATH/encoding injected into the child, and the sandbox
 * launch decision.
 */

/** Extra config fields carried into the mounted executor. */
export interface CmdExecutorConfig extends BashLocalConfig {
  /** Absolute path to `cmd.exe`. */
  readonly cmdPath: string
  /** Directories to prepend to PATH (`extraPath`). */
  readonly pathEntries: readonly string[]
  /** Console code page the script switches to before the command runs. */
  readonly codePage: number
  /** Export PYTHONIOENCODING so Python writes UTF-8 into the pipe. */
  readonly pythonUtf8: boolean
  /** How to launch under a confined sandbox. Defaults to `escalate`. */
  readonly confinedPolicy?: CmdConfinedPolicy
}

/** What the sandbox reported for one execution, remembered until the process settles. */
interface LaunchFacts {
  readonly mode: SandboxMode
  readonly enforcement?: 'full' | 'partial'
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly RunnerFailureRule[]
  readonly runnerProgram: string
  readonly workdir: string
}

/**
 * Decide how to launch.
 *
 * Deliberately **not** `planLaunch()` from `confined.ts`: that function encodes
 * the Git Bash constraint ("MSYS2 cannot start under a restricted token on
 * Windows"), which is exactly inverted for cmd. `cmd.exe` is what the official
 * windows-acl backend uses as its own functional probe (`cmd /c exit 0`), so a
 * confined policy is honoured rather than bypassed, and there is no `fail`
 * branch: no cmd launch can be impossible for sandbox reasons.
 *
 * @param hasSandbox - whether this composition has a sandbox provider at all.
 * @param policyMode - the per-call policy mode, when the caller supplied one.
 * @param choice - the configured handling for confined launches.
 */
export function planCmdLaunch(
  hasSandbox: boolean,
  policyMode: SandboxMode | undefined,
  choice: CmdConfinedPolicy,
): CmdLaunch {
  if (!hasSandbox || policyMode === undefined) return { kind: 'direct', mode: 'danger-full-access' }
  if (policyMode === 'danger-full-access') return { kind: 'direct', mode: 'danger-full-access' }
  if (choice === 'unconfined') return { kind: 'direct', mode: 'danger-full-access' }
  return { kind: 'confine', mode: policyMode }
}

export class CmdExecutor extends LocalBashExecutor {
  // No `as const`: the base class declares `static inject: string[]`, so a
  // readonly tuple is TS2417.
  static inject = ['subprocess']

  private readonly facts = new Map<ShellProcess, LaunchFacts>()
  private readonly scripts = new Map<ShellProcess, CmdScript>()
  private scratchDir: string | undefined

  constructor(ctx: Context, config: CmdExecutorConfig) {
    super(ctx, config)
    // The scratch directory belongs to this executor instance: drop it when the
    // composition unwinds so a reload does not leak one directory per mount.
    this.ctx.effect(() => () => {
      const dir = this.scratchDir
      this.scratchDir = undefined
      if (dir === undefined) return
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Left for the sweeper.
      }
    }, 'cmd-executor: scratch')
  }

  private get extended(): CmdExecutorConfig {
    return this.config as unknown as CmdExecutorConfig
  }

  private get cmdPath(): string {
    return this.extended.cmdPath
  }

  private get codePage(): number {
    return this.extended.codePage ?? 65001
  }

  private get pythonUtf8(): boolean {
    return this.extended.pythonUtf8 !== false
  }

  private get confinedPolicy(): CmdConfinedPolicy {
    return this.extended.confinedPolicy ?? 'escalate'
  }

  private get sandbox(): SandboxProvider | undefined {
    return this.ctx.get('sandbox')
  }

  private get sandboxPolicy(): SandboxPolicyService | undefined {
    return this.ctx.get('sandboxPolicy')
  }

  private get scratch(): string {
    this.scratchDir ??= ensureScratchDir()
    return this.scratchDir
  }

  /**
   * Report a sandbox mode only when the next launch would actually confine.
   *
   * The tool uses `undefined` to decide whether to advertise
   * `sandbox_permissions`; claiming a mode the executor then bypasses would offer
   * the model an escalation that changes nothing.
   */
  override get sandboxMode(): SandboxMode | undefined {
    const mode = this.sandboxPolicy?.defaultMode
    if (this.sandbox === undefined || mode === undefined) return undefined
    if (mode === 'danger-full-access') return mode
    return this.confinedPolicy === 'unconfined' ? undefined : mode
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
  override resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    const env: Record<string, string> = { ...spec.env }
    if (this.extended.pathEntries.length > 0) {
      env.PATH = composePath(this.extended.pathEntries, spec.env?.PATH ?? process.env.PATH ?? process.env.Path)
    }
    if (this.pythonUtf8 && env.PYTHONIOENCODING === undefined) env.PYTHONIOENCODING = 'utf-8'
    // `tool-cmd` normally supplies the policy; this fallback keeps a direct
    // caller (tests, other tools) from reaching `confine()` with no policy.
    return { ...spec, env, sandboxPolicy: spec.sandboxPolicy ?? this.sandboxPolicy?.resolve() }
  }

  override async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    // The script is spawned with the scratch directory as its cwd, so a missing
    // workdir would only surface inside the batch file, after the process
    // started. Fail early with the path the caller actually asked for.
    assertDirectory(spec.workdir, 'working directory')

    const script = materializeCmd(this.scratch, spec.command, {
      codePage: this.codePage,
      workdir: spec.workdir,
    })
    // Spawn from the scratch directory and address the script by bare name: the
    // absolute form breaks for any directory name containing `&`, `(`, `)`,
    // `^`, `,`, `;` or a paired `%NAME%`. The batch file enters `spec.workdir`
    // itself.
    const { argv, cwd } = scriptArgv(this.cmdPath, script)
    const spawnSpec: ShellExecSpec = { ...spec, workdir: cwd }
    const sandbox = this.sandbox
    const policy = spec.sandboxPolicy
    const plan = planCmdLaunch(sandbox !== undefined, policy?.mode, this.confinedPolicy)
    let registered = false

    try {
      if (plan.kind === 'direct') {
        const facts = { mode: plan.mode, denied: false } as const
        const execution = await this.executeArgv(spawnSpec, argv, (process) => {
          registered = true
          this.scripts.set(process, script)
        })
        return decorateResult(execution, (result) => ({ ...result, sandbox: facts }))
      }

      // `planCmdLaunch` only chooses `confine` for a resolved confined policy;
      // the guard keeps the types honest without duplicating the decision.
      if (sandbox === undefined || policy === undefined || policy.mode === 'danger-full-access') {
        throw new Error('cmd-executor: confined launch without a confined sandbox policy')
      }
      const confinedPolicy: SandboxPolicy = { ...policy, mode: plan.mode }
      let confined: ConfinedArgv | undefined
      const execution = await this.executeArgv(
        spawnSpec,
        async (signal) => {
          const prepared = await sandbox.confine(argv, confinedPolicy, signal)
          signal.throwIfAborted()
          confined = prepared
          return prepared.argv
        },
        (process) => {
          registered = true
          this.scripts.set(process, script)
          this.facts.set(process, {
            mode: plan.mode,
            enforcement: confined?.enforcement,
            denialSignatures: confined?.denialSignatures ?? [],
            runnerFailureRules: confined?.runnerFailureRules ?? [],
            runnerProgram: confined?.argv[0] ?? argv[0] ?? this.cmdPath,
            workdir: spec.workdir,
          })
        },
      )
      return decorateResult(
        execution,
        (result) => {
          const ready = confined
          // Mirrors the Git Bash executor: a prepared launch that somehow
          // vanished still reports the mode it asked for, with no denial.
          if (ready === undefined) return { ...result, sandbox: { mode: plan.mode, denied: false } }
          const failure = classifyRunnerFailureMatch(result.exitCode, result.stderr.text, ready.runnerFailureRules)
          if (failure !== undefined) {
            // A sandbox that cannot launch cmd is an environment problem, not a
            // command result; surfacing it as such is what lets the UI say so.
            throw new SandboxUnavailableError(plan.mode, failure.detail)
          }
          return {
            ...result,
            sandbox: {
              mode: plan.mode,
              denied: matchesSignature(result.exitCode, result.stderr.text, ready.denialSignatures),
              enforcement: ready.enforcement,
            },
          }
        },
        (error) => {
          if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
          const ready = confined
          if (ready !== undefined && isRunnerSpawnFailure(error, ready.argv[0], spec.workdir)) {
            throw new SandboxUnavailableError(plan.mode, error instanceof Error ? error.message : String(error))
          }
          throw error
        },
      )
    } finally {
      // `executeArgv` skips `onStarted` when *preparation* times out (for example
      // a `confine()` that never resolves), so nothing registered the script and
      // `onProcessDone` has nothing to dispose. Only the unregistered case is
      // cleaned here: a registered script must survive until its process exits,
      // because a promoted timeout keeps reading it from a background job.
      if (!registered) script.dispose()
    }
  }

  /**
   * Settle sandbox facts and drop the script.
   *
   * The script cannot be removed when the *tool call* returns: a promoted timeout
   * keeps the process running as a background job, and cmd re-reads its batch
   * file line by line. Only a finished process makes the file dead weight.
   */
  protected override onProcessDone(
    process: ShellProcess,
    stderr: string,
    providerRejected: boolean,
    providerError?: unknown,
  ): void {
    this.scripts.get(process)?.dispose()
    this.scripts.delete(process)

    const facts = this.facts.get(process)
    this.facts.delete(process)
    if (facts !== undefined) {
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailureMatch(process.exitCode, stderr, facts.runnerFailureRules) !== undefined
      process.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(process.exitCode, stderr, facts.denialSignatures),
        ...(facts.enforcement !== undefined ? { enforcement: facts.enforcement } : {}),
        ...(runnerFailed ? { runnerFailed: true } : {}),
      }
    }
    super.onProcessDone(process, stderr, providerRejected, providerError)
  }
}

function assertDirectory(path: string, label: string): void {
  let ok = false
  try {
    ok = statSync(path).isDirectory()
  } catch {
    ok = false
  }
  if (!ok) throw new Error(`cmd: ${label} does not exist: ${path}`)
}

/**
 * Replace `execution.result()` in place.
 *
 * Handle identity must be preserved: sandbox facts are keyed by the handle and
 * read back by the base class, so wrapping the handle in another object would
 * drop them.
 */
function decorateResult<T extends ShellExecution>(
  execution: T,
  map: (result: ShellRunResult) => ShellRunResult,
  mapError?: (error: unknown) => never,
): T {
  const base = execution.result.bind(execution)
  let decorated: Promise<ShellRunResult> | undefined
  execution.result = () => {
    decorated ??= mapError === undefined ? base().then(map) : base().then(map, mapError)
    return decorated
  }
  return execution
}
