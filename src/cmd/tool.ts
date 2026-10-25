/**
 * Model-facing `cmd` tool: a Windows `cmd.exe` Consumer of the `ctx.shell`
 * capability seam.
 *
 * This module is a dialect rewrite of `@deepseek-ai/dsh-tool-bash`, which is the
 * golden reference for every line below. That package exports only
 * `{ Config, apply, inject, name }`: `startJob` (:390), `waitOnJob` (:425) and
 * `approveBashEscalation` (:361) are `apply()`-local closures, and the tool name
 * plus the approval `toolName` are hard-coded inside them, so the only faithful
 * port is a copy with `bash` → `cmd`. Each copied block names its source line.
 *
 * Behavior mirrors the bash tool call-for-call: foreground and
 * `run_in_background` execution (with a job registry composed, every call
 * registers its process with `ctx.jobs` as it starts, and a foreground call
 * waits on its job until the timeout passes), the managed `DSH_*` environment
 * through the shared `shell-env` registry, per-call sandbox-policy resolution
 * (the calling session's mode and cwd travel to the confining executor), the
 * sandbox-denial rendering with the same-turn escalation surface
 * (`sandbox_permissions` + `justification` resolved through `ctx.approval`),
 * and the shared marker/truncation rendering story.
 *
 * The prompt section is NOT registered here: `installCmdSession` in
 * `src/replace.ts` owns the single `tool:cmd` registration, because
 * `NamedEntries` throws on a duplicate section name in one scope.
 *
 * @module dsh-terminal-shell/cmd/tool
 */
import { isAbsolute, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  JobChunk,
  JobHooks,
  JobId,
  JobOutcome,
  JobOutputSource,
  JobRegistry,
} from '@deepseek-ai/dsh-jobs'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  sandboxDenialMarker,
  sandboxPermissionsDescription,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { DSH_ENV_PREFIX, parseExitStatus } from '@deepseek-ai/dsh-shell'
import type {
  CollectedOutput,
  ShellExecSpec,
  ShellExecution,
  ShellRunResult,
  ShellSandboxInfo,
} from '@deepseek-ai/dsh-shell'
// Type-only side-effect imports: these packages augment `Context` with the
// `shellEnv` and `workingDirectory` services called below. `import type {}`
// keeps the augmentations in the program while emitting nothing, so the bundle
// still depends only on the seams it actually uses.
import type {} from '@deepseek-ai/dsh-shell-env'
import type {} from '@deepseek-ai/dsh-working-directory'
import { TOOL_ABORTED, defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResult, ToolResultView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/**
 * `ctx.jobs` keys its registry by an open `JobKindMap`; declaration merging is
 * the documented way for a plugin to add its own namespace (the same pattern
 * `@deepseek-ai/dsh-tool-pwsh` uses for `pwsh`).
 */
declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    cmd: 'cmd'
  }
}

export const name = 'tool-cmd'
// No `as const`: cordis types `inject` as a mutable `string[]`, and the official
// tools declare it the same way. `systemPrompt` stays listed even though this
// plugin registers no section of its own: the tool advertises the seam it is
// documented to depend on, exactly like the bash tool.
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv', 'workingDirectory']

/** Runtime configuration schema for the cmd tool plugin. */
export const Config = z.object({
  enableRunInBackground: z.boolean().default(true),
  promoteOnTimeout: z.boolean().default(true),
})

/**
 * Configuration for the cmd tool. Both keys default to `true`; declaring them
 * optional keeps this interface assignable from the schema's inferred output, so
 * cordis can unify the plugin's config type from either side. This is the same
 * type/value declaration merge the bash tool uses (`interface Config` plus
 * `const Config: z<Config>`).
 */
export interface Config {
  /**
   * Expose `run_in_background` while a job registry is composed (default true);
   * disabled calls are also rejected. Without a registry the tool is
   * foreground-only regardless.
   */
  enableRunInBackground?: boolean
  /**
   * Keep a foreground command that reaches its timeout running as a background
   * job instead of killing it (default true; requires a job registry).
   */
  promoteOnTimeout?: boolean
}

/** The tool's argument shape; the last three keys are composition-dependent. */
interface CmdArgs {
  readonly description: string
  readonly command: string
  readonly timeoutMs?: number
  readonly workdir?: string
  readonly run_in_background?: boolean
  readonly sandbox_permissions?: string
  readonly justification?: string
}

/** The `foreground` output branch: the canonical shell result plus the tool envelope. */
interface CmdForegroundValue extends ShellRunResult {
  readonly kind: 'foreground'
  readonly cwd: string
  readonly stopped?: string
}

/** The `promoted` output branch: a foreground call that stopped waiting. */
interface CmdPromotedValue {
  readonly kind: 'promoted'
  readonly cwd: string
  readonly jobId: string
  readonly timeoutMs: number
  readonly output: string
}

/**
 * The foreground branch as `output.schema` types it. `mode` is an open string
 * there (the schema is copied verbatim from the bash tool), while the marker
 * helpers want the `SandboxMode` union; {@link renderResult} is the single place
 * that narrows, so nothing else has to.
 */
interface RenderableCmdResult {
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly timeoutMs: number
  readonly stopped?: string
  readonly stdout: CollectedOutput
  readonly stderr: CollectedOutput
  readonly sandbox?: { readonly mode: string; readonly denied: boolean }
}

/**
 * Official `startJob` is plain JS, so the attached-job record has no declared
 * type there; this is its shape (official :390-421).
 */
interface AttachedCmdJob {
  readonly id: JobId
  process: () => ShellExecution | undefined
  stopped: () => string | undefined
}

/**
 * The host's tool result, widened by the `value` the output projector attaches
 * and the presenter reads (official `result.value?.kind`, :275). `ToolResult`
 * itself does not declare `value`, so it is intersected in rather than cast —
 * `ToolResult` stays assignable to this type, which keeps
 * `presentResult: presentCmdResult` type-checked.
 */
type PresentedToolResult = ToolResult & { readonly value?: { readonly kind?: unknown } }

/**
 * Sandbox facts worth the terminal detail: a runner that never ran the
 * command, or a denial (with the escalation hint this composition offers).
 * Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:22`.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the markers to append, oldest first.
 */
function sandboxNotes(
  sandbox: ShellSandboxInfo | undefined,
  escalationModes: readonly SandboxMode[] = [],
): string[] {
  if (sandbox?.runnerFailed) {
    return [
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`,
    ]
  }
  if (sandbox?.denied) {
    const notes = [sandboxDenialMarker(sandbox.mode)]
    if (escalationModes.length > 0) notes.push(escalationHintMarker('command'))
    return notes
  }
  return []
}

/**
 * Map a settled background process onto the generic job-outcome vocabulary:
 * `killed` stays `killed` (detail: the signal when one is known), everything
 * else is `completed` with the exit code as detail. A nonzero command exit is
 * reported, not failed, exactly like the foreground rendering. Sandbox facts
 * join the detail, since a job's terminal reason is the one line every reader
 * shows. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:42`.
 * @param proc - the settled process handle.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the outcome for the `ctx.jobs` registration.
 */
function processOutcome(
  proc: ShellExecution,
  escalationModes: readonly SandboxMode[] = [],
): JobOutcome {
  const base: JobOutcome =
    proc.status === 'killed'
      ? {
          status: 'killed',
          detail: proc.signal !== null ? `signal: ${proc.signal}` : 'killed before exit',
        }
      : { status: 'completed', detail: `exit code: ${proc.exitCode ?? 0}` }
  const notes = sandboxNotes(proc.sandbox, escalationModes)
  return notes.length === 0
    ? base
    : { ...base, detail: `${base.detail}; ${notes.join(' ')}` }
}

/**
 * The process's non-consuming stream readers as registry pull sources. They bind
 * lazily because the process is spawned inside the starter, after the registry
 * admitted the job; a read before the spawn yields nothing, and the pump keeps
 * the model's consuming cursor untouched. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:66`.
 * @param proc - the started process, once the starter has spawned it.
 * @returns one source per stream, stdout first.
 */
function processSources(proc: () => ShellExecution | undefined): readonly JobOutputSource[] {
  const source = (channel: 'stdout' | 'stderr'): JobOutputSource => ({
    channel,
    read: (fromByte: number) => {
      const live = proc()
      return live === undefined
        ? { text: '', nextOffset: fromByte, lossy: false }
        : live.observed[channel].readFrom(fromByte)
    },
  })
  return [source('stdout'), source('stderr')]
}

/**
 * The ring chunks of one consuming registry read as the shell tools render a
 * process read: stdout chunks in order, then every stderr chunk in one
 * `[stderr]` section, so the output a foreground call hands over when it stops
 * waiting reads exactly like the `job_output` reads that follow it. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:88`.
 * @param chunks - the chunks since the model cursor, in offset order.
 * @returns the delta text, possibly empty.
 */
function ringDelta(chunks: readonly JobChunk[]): string {
  const out = chunks
    .filter((chunk) => chunk.channel !== 'stderr')
    .map((chunk) => chunk.text)
    .join('')
  const err = chunks
    .filter((chunk) => chunk.channel === 'stderr')
    .map((chunk) => chunk.text)
    .join('')
  const separator = out.length > 0 && !out.endsWith('\n') ? '\n' : ''
  return out + (err.length > 0 ? `${separator}[stderr]\n${err}` : '')
}

/**
 * Adapt asynchronous shell preparation after job admission without exposing a
 * partial process. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:100`;
 * the local handle is named `proc` so it does not shadow Node's global
 * `process`.
 * @param start - starts the process with job-owned cancellation.
 * @param outcome - projects the settled process into the job outcome.
 * @returns synchronous job hooks whose completion includes preparation and process settlement.
 */
function processJob(
  start: (signal: AbortSignal) => Promise<ShellExecution>,
  outcome: (proc: ShellExecution) => JobOutcome,
): JobHooks {
  const controller = new AbortController()
  let proc: ShellExecution | undefined
  return {
    cancel: (reason) => {
      if (controller.signal.aborted) return
      controller.abort(reason)
      proc?.kill()
    },
    done: (async (): Promise<JobOutcome> => {
      try {
        proc = await start(controller.signal)
        try {
          if (controller.signal.aborted) proc.kill()
        } finally {
          await proc.done
        }
        return outcome(proc)
      } catch (error) {
        return {
          status: controller.signal.aborted && proc === undefined ? 'killed' : 'failed',
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    })(),
  }
}

/**
 * Append the truncation notice (with the full-output spill path) to a stream's
 * text. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:135`.
 */
function streamText(output: CollectedOutput): string {
  if (!output.truncated) return output.text
  return `${output.text}\n[output truncated; full output: ${output.spillPath ?? '(unavailable)'}]`
}

/**
 * Shape one finished run into the text the model sees: stdout, then a marked
 * stderr section, then exit-status markers. Non-zero exits are reported, not
 * errored — the model decides how to react; only infrastructure failures (spawn
 * errors, aborts) surface as isError results. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:150`.
 * @param result - the completed foreground run from the executor.
 * @param escalationModes - the escalation targets this composition advertises;
 *   non-empty adds the same-turn escalation hint after a denial marker
 *   (default `[]`: no hint).
 * @returns the model-facing text.
 */
function renderResult(result: RenderableCmdResult, escalationModes: readonly SandboxMode[] = []): string {
  const out = streamText(result.stdout)
  const err = streamText(result.stderr)
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers: string[] = []
  if (result.sandbox?.denied) {
    // The schema types `mode` as an open string (verbatim from the bash tool),
    // but the marker helper wants the `SandboxMode` union the executor produced.
    markers.push(sandboxDenialMarker(result.sandbox.mode as SandboxMode))
    if (escalationModes.length > 0) markers.push(escalationHintMarker('command'))
  }
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.stopped !== undefined) markers.push(`[stopped: ${result.stopped}]`)
  if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`)
  else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`)
  if (markers.length === 0) return body
  if (!body.endsWith('\n')) body += '\n'
  return body + markers.join('\n')
}

/**
 * Shape a foreground call that stopped waiting into the text the model sees: the
 * output captured so far (one consuming registry read taken at that point, so
 * `job_output` continues exactly after it), then the still-running marker and
 * the job hand-off guidance. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:181`.
 * @param promoted - the promoted result value: the job id, the wait that
 *   expired, and the output so far.
 * @returns the model-facing text for a promoted call.
 */
function renderPromoted(promoted: {
  readonly jobId: string
  readonly timeoutMs: number
  readonly output: string
}): string {
  return `${promoted.output.length > 0 ? (promoted.output.endsWith('\n') ? promoted.output : `${promoted.output}\n`) : ''}[still running after ${promoted.timeoutMs}ms; moved to background job ${promoted.jobId}]\nThe command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.`
}

/**
 * Shape the one consuming registry read a foreground call embeds in its result
 * when it stops waiting: the output produced so far, plus the dropped-output
 * notice (naming the job's spill files) when the model cursor fell behind the
 * ring, and the sandbox notices. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:197`.
 * @param delta - the read's chunks as rendered text.
 * @param lossy - whether bytes before the delta were evicted unread.
 * @param spillPaths - the complete-stream files the job currently advertises.
 * @param sandbox - settled sandbox facts, when this was a confined process.
 * @param escalationModes - escalation targets advertised by this composition.
 * @returns the delta text with any loss or sandbox notice appended.
 */
function renderJobRead(
  delta: string,
  lossy: boolean,
  spillPaths: readonly string[],
  sandbox: ShellSandboxInfo | undefined,
  escalationModes: readonly SandboxMode[] = [],
): string {
  const notices: string[] = []
  if (lossy) {
    notices.push(
      `[some output was dropped from memory; full output: ${spillPaths.length > 0 ? spillPaths.join(', ') : '(unavailable)'}]`,
    )
  }
  if (sandbox?.runnerFailed) {
    notices.push(
      `[sandbox: the sandbox runner itself failed under ${sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`,
    )
  } else if (sandbox?.denied) {
    notices.push(sandboxDenialMarker(sandbox.mode))
    if (escalationModes.length > 0) notices.push(escalationHintMarker('command'))
  }
  if (notices.length === 0) return delta
  return `${delta}${delta.length > 0 && !delta.endsWith('\n') ? '\n' : ''}${notices.join('\n')}`
}

/**
 * Reject arguments the schema cannot express. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:235` (only the name changes).
 * @param args - the validated call arguments.
 * @param effectiveMode - the standing sandbox mode, when the executor confines.
 */
function validateCmdArgs(args: CmdArgs, effectiveMode: SandboxMode | undefined): void {
  if (args.command.trim().length === 0) throw new Error('invalid command: expected a non-empty string')
  if (args.description.trim().length === 0) throw new Error('invalid description: expected a non-empty string')
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
  if (args.sandbox_permissions !== undefined && args.sandbox_permissions === effectiveMode) return
  const justification =
    args.sandbox_permissions === undefined && args.justification?.trim() === ''
      ? undefined
      : args.justification
  validateEscalationArgs(args.sandbox_permissions, justification)
}

/**
 * The tool contract is cmd-dialect: native `C:\...` paths, `%VAR%` expansion,
 * `/` switches. The transport runs the text from a one-shot batch file, so the
 * caveats that follow from that are stated here rather than left to be
 * discovered: `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to the transport script,
 * not to anything the caller wrote.
 */
function cmdDescription(): string {
  return [
    'Execute a Windows `cmd.exe` command and return its stdout/stderr.',
    'Each call runs in a fresh shell: no variable, directory or `setlocal` state survives between calls; pass `workdir` instead of using `cd`.',
    `Managed \`$${DSH_ENV_PREFIX}*\` variables expose current harness environment facts.`,
    'The command runs from a one-shot batch file, so batch syntax (`%VAR%`, `&`, `&&`, `||`, pipes, redirection, `( )` blocks, `if`, `for`, `call :label`, multi-line) behaves exactly as in a `.cmd` file. `%~dp0`, `%0`, `%1`..`%9` and `%*` refer to that internal file and are not useful; use `%CD%` for the working directory.',
    'Command echoing is off for the whole call (`cmd.exe /q`) and is not restored, so the command lines themselves never appear in the output; only what the commands print is returned.',
    'Non-ASCII output requires the console code page to be UTF-8, which is the default; some legacy programs ignore it.',
    'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available.',
    'Provide `description` before `command` in the arguments.',
    'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.',
  ].join(' ')
}

/**
 * Pending-call presentation. Copied from
 * `@deepseek-ai/dsh-tool-bash/lib/index.js:246`; a background call has no
 * terminal to show, so it becomes a generic `execute` card carrying the
 * description, while a foreground call is the terminal card itself.
 * @param args - the call arguments.
 * @returns the card intent, or `undefined` to keep the host's default.
 */
function presentCmdCall(args: CmdArgs): ToolCallView | undefined {
  if (args.run_in_background === true) {
    return {
      card: 'generic',
      title: args.command,
      kind: 'execute',
      rawInput: args.command,
      content: [{ type: 'text', text: args.description }],
    }
  }
  return {
    card: 'terminal',
    title: args.command,
    description: args.description,
    ...(args.workdir !== undefined ? { cwd: args.workdir } : {}),
  }
}

/**
 * Present completed foreground output as a terminal; background
 * acknowledgements and execution errors use generic fenced output without an
 * exit-status pill. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:268`.
 * @param args - the call arguments.
 * @param result - the finished result the host is about to show.
 * @returns the result card, or `undefined` to keep the raw content.
 */
function presentCmdResult(
  args: CmdArgs,
  result: PresentedToolResult,
): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  const raw = block.text
  const isBackground = typeof args === 'object' && args !== null && args.run_in_background === true
  const isPromoted = result.value?.kind === 'promoted'
  if (isBackground || isPromoted || result.isError) {
    return {
      card: 'generic',
      content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }],
    }
  }
  const { body, ...exit } = parseExitStatus(raw)
  return { card: 'terminal', output: body, ...exit }
}

/**
 * Resolve a relative per-call override against the Session's current directory.
 * Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:289`.
 */
function resolveWorkdir(
  modelWorkdir: string | undefined,
  sessionCwd: string | undefined,
): string | undefined {
  if (modelWorkdir === undefined) return sessionCwd
  if (sessionCwd !== undefined && !isAbsolute(modelWorkdir)) return `${sessionCwd}${sep}${modelWorkdir}`
  return modelWorkdir
}

/**
 * Detach the executor DTO from readonly Service Definition types into plain JSON
 * data. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:295`.
 * @param result - the completed foreground run.
 * @param cwd - the working directory the run used.
 * @returns the canonical `foreground` branch payload.
 */
function canonicalCmdResult(result: ShellRunResult, cwd: string) {
  const output = (stream: CollectedOutput) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...(stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {}),
  })
  return {
    cwd,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...(result.sandbox !== undefined
      ? {
          sandbox: {
            mode: result.sandbox.mode,
            denied: result.sandbox.denied,
            ...(result.sandbox.enforcement !== undefined
              ? { enforcement: result.sandbox.enforcement }
              : {}),
            ...(result.sandbox.runnerFailed !== undefined
              ? { runnerFailed: result.sandbox.runnerFailed }
              : {}),
          },
        }
      : {}),
  }
}

/**
 * The structured abort the foreground paths throw when the caller cancels the
 * call. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:319`.
 */
function toolAborted(): HarnessError {
  const error = new HarnessError('tool call aborted', TOOL_ABORTED)
  error.name = 'AbortError'
  return error
}

/**
 * Canonical background-handle properties shared by the cmd output union.
 * Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:325`.
 */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
  cwd: { type: 'string', required: true },
} as const

export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  const promoteOnTimeout = (config.promoteOnTimeout ?? true) && backgroundEnabled
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-cmd: the mounted cmd executor confines but ctx.sandboxPolicy is missing')
  }
  /** Resolve the complete standing policy for this call when a confining executor is mounted. */
  const resolveSandboxPolicy = (exec: ToolRunContext): SandboxExecutionPolicy | undefined =>
    sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE anything
   * executes, delegating the shared fail-closed sequence (strict widening,
   * channel resolution, outcome mapping) to {@link approveEscalation}. Copied
   * from `@deepseek-ai/dsh-tool-bash/lib/index.js:360`; the approval's
   * `toolName` is `'cmd'` — it is what the user sees in the approval prompt and
   * what the approval channel keys the decision on, so copying the bash tool's
   * `'bash'` here would approve the wrong tool.
   * @param mode - the requested escalation target.
   * @param justification - the model's one-sentence reason for the widening.
   * @param exec - this call's execution context (agent, call id, signal).
   * @param standingPolicy - the resolved standing policy for this call.
   * @returns the mode the approval settled on.
   */
  const approveCmdEscalation = async (
    mode: string,
    justification: string,
    exec: ToolRunContext,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<SandboxMode> => {
    if (escalationModes.length === 0) {
      throw new Error(
        'sandbox_permissions is not available in this composition (no sandboxing executor to escalate)',
      )
    }
    // Fail closed instead of asserting: escalation modes are only advertised
    // when the executor confines, and a confining composition guarantees
    // `ctx.sandboxPolicy` above, so this branch is unreachable — but the tool
    // must never widen a policy it could not resolve.
    if (standingPolicy === undefined) {
      throw new Error('tool-cmd: sandbox escalation without a resolved standing policy')
    }
    const effectiveMode = standingPolicy.mode
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: 'command' },
      {
        approver: ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName: 'cmd',
        signal: exec.signal,
      },
    )
  }
  /**
   * One registration of the `cmd` tool. With a registry, every call registers
   * its process as a job at its start; without one the tool is foreground-only
   * and the executor's deadline kills the command. Copied from
   * `@deepseek-ai/dsh-tool-bash/lib/index.js:386`.
   * @param jobs - the job registry, or `undefined` for a foreground-only mount.
   */
  const cmdTool = (jobs: JobRegistry | undefined) => {
    const background = jobs !== undefined
    const promote = background && promoteOnTimeout
    /**
     * Register the command as a job; the process spawns inside the starter,
     * after admission. Copied from
     * `@deepseek-ai/dsh-tool-bash/lib/index.js:390`.
     */
    const startJob = (
      registry: JobRegistry,
      args: CmdArgs,
      exec: ToolRunContext,
      spec: ShellExecSpec,
    ): AttachedCmdJob => {
      let proc: ShellExecution | undefined
      let stopped: string | undefined
      return {
        id: registry.start({
          kind: 'cmd',
          label: args.command,
          toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
          ...(exec.agent !== undefined ? { owner: exec.agent.id } : {}),
          output: processSources(() => proc),
          run: () => {
            const hooks = processJob(
              async (signal) => {
                proc = await ctx.shell.execute({ ...spec, signal })
                return proc
              },
              (started) => processOutcome(started, escalationModes),
            )
            return {
              done: hooks.done,
              cancel: (reason) => {
                stopped = reason
                hooks.cancel(reason)
              },
            }
          },
        }),
        process: () => proc,
        stopped: () => stopped,
      }
    }
    /**
     * Wait on a registered foreground command until it settles or the timeout
     * passes. Copied from `@deepseek-ai/dsh-tool-bash/lib/index.js:425`. The
     * signature is `(registry, attached, exec, spec)` — the owner comes from
     * `exec.agent?.id`, the wait bound from `spec.timeoutMs`, and cancellation
     * from `exec.signal`.
     */
    const waitOnJob = async (
      registry: JobRegistry,
      attached: AttachedCmdJob,
      exec: ToolRunContext,
      spec: ShellExecSpec,
    ): Promise<CmdForegroundValue | CmdPromotedValue> => {
      const owner = exec.agent?.id
      const timeoutMs = spec.timeoutMs
      /**
       * Stop the job on this call's own account and stay on it until it
       * settles, so the settlement is awaited and no completion notice follows
       * a result this call already carries; the record then leaves with the
       * call, as the model never saw the id.
       */
      const stop = async (reason: string) => {
        registry.kill(attached.id, owner, reason)
        const settled = await registry.wait(attached.id, timeoutMs, owner)
        if (settled.status !== 'running' && settled.status !== 'stopping') {
          registry.remove(attached.id, owner)
        }
        return settled
      }
      let view
      try {
        view = await registry.wait(attached.id, timeoutMs, owner, exec.signal)
      } catch {
        await stop('tool call aborted')
        throw toolAborted()
      }
      if ((view.status === 'running' || view.status === 'stopping') && attached.process() === undefined) {
        await stop('timed out during preparation')
        return {
          kind: 'foreground',
          cwd: spec.workdir,
          exitCode: null,
          signal: null,
          timedOut: true,
          aborted: false,
          timeoutMs,
          stdout: { text: '', truncated: false },
          stderr: { text: '', truncated: false },
          ...(spec.sandboxPolicy !== undefined
            ? { sandbox: { mode: spec.sandboxPolicy.mode, denied: false } }
            : {}),
        }
      }
      if (view.status === 'running' || view.status === 'stopping') {
        const read = registry.read(attached.id, owner)
        return {
          kind: 'promoted',
          cwd: spec.workdir,
          jobId: attached.id,
          timeoutMs,
          output: renderJobRead(
            ringDelta(read.chunks),
            read.lossy,
            read.job.output.spillPaths ?? [],
            attached.process()?.sandbox,
            escalationModes,
          ),
        }
      }
      registry.remove(attached.id, owner)
      const proc = attached.process()
      if (proc === undefined) throw new Error(view.detail)
      const result = await proc.result()
      const stopped = attached.stopped()
      return {
        kind: 'foreground',
        ...canonicalCmdResult(result, spec.workdir),
        ...(stopped !== undefined ? { stopped } : {}),
      }
    }
    return defineTool({
      name: 'cmd',
      description: cmdDescription(),
      parameters: {
        description: {
          type: 'string',
          required: true,
          description:
            'Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: "dir /b" → "List files in current directory"; "git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
        },
        command: {
          type: 'string',
          required: true,
          description: 'The cmd.exe command to execute.',
        },
        timeoutMs: {
          type: 'number',
          description: promote
            ? 'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.'
            : 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.',
        },
        workdir: {
          type: 'string',
          description:
            'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.',
        },
        ...(background
          ? {
              run_in_background: {
                type: 'boolean',
                description:
                  'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.',
              },
            }
          : {}),
        ...(escalationModes.length > 0
          ? {
              sandbox_permissions: {
                type: 'string',
                enum: [...escalationModes],
                description: sandboxPermissionsDescription('command'),
              },
              justification: {
                type: 'string',
                description:
                  'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access. Use the language of the user’s current request.',
              },
            }
          : {}),
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: BACKGROUND_OUTPUT_PROPERTIES,
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'promoted' },
                cwd: { type: 'string', required: true },
                jobId: { type: 'string', required: true },
                timeoutMs: { type: 'number', required: true },
                output: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'foreground' },
                cwd: { type: 'string', required: true },
                exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
                signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                timedOut: { type: 'boolean', required: true },
                aborted: { type: 'boolean', required: true },
                stopped: { type: 'string' },
                timeoutMs: { type: 'number', required: true },
                stdout: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: 'string', required: true },
                    truncated: { type: 'boolean', required: true },
                    spillPath: { type: 'string' },
                  },
                },
                stderr: {
                  type: 'object',
                  additionalProperties: false,
                  required: true,
                  properties: {
                    text: { type: 'string', required: true },
                    truncated: { type: 'boolean', required: true },
                    spillPath: { type: 'string' },
                  },
                },
                sandbox: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    mode: { type: 'string', required: true },
                    denied: { type: 'boolean', required: true },
                    enforcement: { type: 'string' },
                    runnerFailed: { type: 'boolean' },
                  },
                },
              },
            },
          ],
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.kind === 'background'
                ? `started background job ${value.jobId}`
                : value.kind === 'promoted'
                  ? renderPromoted(value)
                  : renderResult(value, escalationModes),
          },
        ],
        presentationMeta: (_args, value) => ({ cwd: value.cwd }),
      },
      async execute(args, exec) {
        const standingPolicy = resolveSandboxPolicy(exec)
        validateCmdArgs(args, standingPolicy?.mode)
        const approvedMode =
          args.sandbox_permissions !== undefined && args.justification !== undefined
            ? await approveCmdEscalation(
                args.sandbox_permissions,
                args.justification,
                exec,
                standingPolicy,
              )
            : undefined
        // `standingPolicy` is guaranteed here whenever `approvedMode` is set —
        // `approveCmdEscalation` throws without a standing policy — but it stays
        // an explicit branch instead of a non-null assertion so the spread below
        // only ever runs on a narrowed value.
        const policy: SandboxExecutionPolicy | undefined =
          approvedMode === undefined || standingPolicy === undefined
            ? standingPolicy
            : { ...standingPolicy, mode: approvedMode }
        const cwd =
          exec.agent === undefined
            ? undefined
            : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const workdir = resolveWorkdir(args.workdir, cwd)
        // `sandboxPolicy` must stay a NESTED request field: spreading `...policy`
        // would flatten `mode` onto the request and leave `request.sandboxPolicy`
        // undefined, so a confining executor falls back to the standing policy —
        // the user approved `danger-full-access` and the command still runs
        // confined. Object spread also bypasses TypeScript's excess-property
        // check, so that bug compiles; only an escalation test catches it.
        const request = {
          command: args.command,
          ...(workdir !== undefined ? { workdir } : {}),
          ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
          dshEnv: ctx.shellEnv.collect(exec),
          ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
        }
        // Background branch: all four guards, in the official order.
        if (args.run_in_background === true) {
          if (!backgroundEnabled) {
            throw new Error(
              'run_in_background is disabled for this deployment (enableRunInBackground: false)',
            )
          }
          if (jobs === undefined) {
            throw new Error(
              'background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs',
            )
          }
          if (exec.signal.aborted) throw toolAborted()
          const spec = ctx.shell.resolve({ ...request, onExpiry: 'none' })
          // Annotated: the schema's `oneOf` discriminates on `kind`, so the
          // returned object must keep the literal type instead of widening to
          // `{ kind: string }` and failing to match its own branch.
          const started: { kind: 'background'; jobId: string; cwd: string } = {
            kind: 'background',
            jobId: startJob(jobs, args, exec, spec).id,
            cwd: spec.workdir,
          }
          return started
        }
        // Promote branch: the official code resolves a SEPARATE spec here,
        // without the call's signal — the job owns its own AbortController, and
        // this call stops waiting rather than killing the command.
        if (jobs !== undefined && promote) {
          const spec = ctx.shell.resolve({ ...request, onExpiry: 'none' })
          let attached: AttachedCmdJob | undefined
          try {
            attached = startJob(jobs, args, exec, spec)
          } catch (error) {
            // A refused registration must not fail the call: fall back to the
            // foreground, losing only the timeout-promotion ability.
            ctx.logger.warn(
              `cmd: job registration refused, running in the foreground with the timeout kill instead: ${String(error)}`,
            )
          }
          if (attached !== undefined) return waitOnJob(jobs, attached, exec, spec)
        }
        const spec = ctx.shell.resolve({ ...request, signal: exec.signal })
        const result = await (await ctx.shell.execute(spec)).result()
        if (result.aborted) throw toolAborted()
        // Annotated for the same reason as the background branch above: the
        // object spread would otherwise widen `kind` to `string` and the value
        // would stop matching the schema's `foreground` branch.
        const foreground: CmdForegroundValue = {
          kind: 'foreground',
          ...canonicalCmdResult(result, spec.workdir),
        }
        return foreground
      },
      presentCall: presentCmdCall,
      presentResult: presentCmdResult,
    })
  }
  // Registration and job wiring: copied from the official block at
  // `@deepseek-ai/dsh-tool-bash/lib/index.js:715`, with `kind: 'cmd'`.
  if (!backgroundEnabled) {
    ctx.tools.register(cmdTool(undefined))
    return
  }
  let foregroundOnly: (() => void) | undefined =
    ctx.get('jobs') === undefined ? ctx.tools.register(cmdTool(undefined)) : undefined
  ctx.inject(['jobs'], (jobCtx) => {
    foregroundOnly?.()
    foregroundOnly = undefined
    const unregister = ctx.tools.register(cmdTool(jobCtx.jobs))
    jobCtx.effect(() => () => {
      unregister()
      // `ctx.fiber.state === 2` is ACTIVE — NOT "disposed" (that is 4). The
      // official code re-registers the foreground-only tool only while this
      // plugin is still mounted, so a reload that is tearing down does not
      // resurrect a registration nobody will ever unregister.
      if (ctx.fiber.state === 2) foregroundOnly = ctx.tools.register(cmdTool(undefined))
    })
  })
  // The prompt section is deliberately not registered here; see the module doc.
}
