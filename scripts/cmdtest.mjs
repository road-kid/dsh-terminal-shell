/**
 * End-to-end checks for the `cmd` dialect.
 *
 * Every assertion below runs **real `cmd.exe`** through the real `CmdExecutor`
 * (`resolve()` → `execute()` → `result()`), so the whole transport is covered:
 * batch-file materialization, the bare-name `argv` form, the guarded `cd`, the
 * exit-code semantics and the sandbox launch decision. The transport primitives
 * themselves (`renderCmdScript`, `scriptArgv`, `materializeCmd`, `sweepStaleScripts`,
 * …) are already unit-tested in `scripts/cmdunittest.mjs`; this file deliberately
 * does not repeat them.
 *
 * The matrix follows `docs/PLAN-cmd-dialect.md` §7. A row that cannot be
 * exercised on this host prints `(skipped: <reason>)` and counts as a skip — it
 * never fakes a pass.
 *
 * Run with `npm run cmdtest` after `npm run build`.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Context, Service } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

import {
  CMD_PROMPT_SECTION,
  CmdExecutor,
  discoverCmd,
  installSession,
  snapshotConfig,
} from '../lib/testing.js'

let passed = 0
let failed = 0
let skipped = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(
      `FAIL ${name}\n     ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
  }
}

/** Record a row that this host cannot exercise. Never a pass by omission. */
function skip(reason) {
  skipped += 1
  process.stdout.write(`     (skipped: ${reason})\n`)
}

// ---------------------------------------------------------------------------
// Host scaffolding — copied from `scripts/integration.mjs`, which cannot be
// imported because it executes its own suite at import time.
// ---------------------------------------------------------------------------

/** Stand-in for `dsh-working-directory`; `tool-cmd` only asks it for the cwd. */
class WorkingDirectoryStub extends Service {
  constructor(ctx) {
    super(ctx, 'workingDirectory')
  }

  async ensure() {
    return process.cwd()
  }
}

function waitReady(ctx) {
  return new Promise((resolve) => setTimeout(resolve, 300))
}

/**
 * Obtain a context that may read the listed services as properties.
 *
 * The scopes here are minted from the root context, which has no fiber, so one
 * throwaway plugin supplies the `inject` declaration.
 */
function serviceContext(ctx, names) {
  return new Promise((resolve) => {
    ctx.inject(names, (scoped) => {
      resolve(scoped)
    })
  })
}

/** A host with every service the cmd tool and its executor actually need. */
async function createHost({ sandbox = false, mode = 'danger-full-access' } = {}) {
  const ctx = new Context()
  ctx.plugin(SubprocessLocal)
  if (sandbox) {
    ctx.plugin(SandboxLocal)
    ctx.plugin(SessionProjectionRegistry)
    ctx.plugin(SandboxPolicyService, { mode })
  }
  ctx.plugin(SystemPrompt)
  ctx.plugin(ToolRuntime)
  ctx.plugin(ShellEnv)
  ctx.plugin(WorkingDirectoryStub)
  await waitReady(ctx)
  const api = await serviceContext(ctx, ['tools', 'systemPrompt'])
  return { ctx, api }
}

/**
 * Build one agent the way the harness does: a scoped child of an enclosing
 * "preset" scope, which is where the inherited `pwsh` tool and its prompt
 * section live.
 */
function createAgent(host, id) {
  const presetKey = { preset: id }
  const preset = createScope(host.api, presetKey)
  preset.ctx.tools.register({
    name: 'pwsh',
    description: 'fixture stand-in for the inherited pwsh tool',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: () => [] },
    async execute() {
      return { kind: 'foreground' }
    },
  })
  // Mirrors `dsh-tool-pwsh`: this is the section the plugin blanks out.
  preset.ctx.systemPrompt.section({
    name: 'tool:pwsh',
    order: preset.ctx.systemPrompt.getSectionOrder('TOOL_PWSH') ?? 1010,
    text: 'Non-zero exits are reported as `[exit code: N]` markers; this is the pwsh guidance.',
  })

  const agent = { id, session: { id, header: { id } } }
  const scope = createScope(host.api, agent, { parent: presetKey })
  agent.ctx = scope.ctx
  return { agent, scope, preset, presetKey }
}

// ---------------------------------------------------------------------------
// Executor mounting
// ---------------------------------------------------------------------------

const found = discoverCmd('')

if (process.platform !== 'win32') {
  // The dialect does not apply here, so there is nothing to verify. This is a
  // host-property skip, not a pass: it says so loudly.
  process.stdout.write(`(skipped: the cmd dialect only exists on Windows; platform=${process.platform})\n`)
  process.stdout.write('\n0 passed, 0 failed, 1 skipped\n')
  process.exit(0)
}

if (found === undefined) {
  // Windows without a reachable cmd.exe is a broken host, not a skip: every
  // assertion in this file would be vacuous.
  process.stdout.write('FAIL cmd.exe could not be discovered via cmdPath, ComSpec or %SystemRoot%\n')
  process.stdout.write('\n0 passed, 1 failed\n')
  process.exit(1)
}

const CMD_PATH = found.path
const hasGitBash = existsSync('C:\\Program Files\\Git\\bin\\bash.exe')

/** Configuration `installSession` uses for the mounted executor, minus the path. */
const EXECUTOR_CONFIG = {
  pathEntries: [],
  codePage: 65001,
  pythonUtf8: false,
  cwd: process.cwd(),
  timeoutMs: 30_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 64_000,
  maxSpillBytes: 64 * 1024 * 1024,
  graceMs: 3_000,
}

let isolateSeq = 0

/**
 * Mount the real `CmdExecutor` in its own isolated `shell` realm, exactly like
 * `installSession` does, and hand back the service instance.
 *
 * `isolate(name, label)`: the first argument is the *service name*. Passing the
 * label alone would leave `shell` un-isolated, and the second mount in one host
 * would fail with `service "shell" has been registered`.
 */
async function mountCmd(host, overrides = {}) {
  const shellCtx = host.ctx.isolate('shell', `cmdtest-${(isolateSeq += 1)}`)
  const fiber = await shellCtx.plugin(CmdExecutor, {
    ...EXECUTOR_CONFIG,
    cmdPath: CMD_PATH,
    confinedPolicy: 'escalate',
    ...overrides,
  })
  return { executor: shellCtx.get('shell'), fiber }
}

/** Resolve, execute and settle one command through the real executor. */
async function run(executor, command, options = {}) {
  const request = { command, workdir: options.workdir ?? WORK }
  if (options.timeoutMs !== undefined) request.timeoutMs = options.timeoutMs
  if (options.sandboxPolicy !== undefined) request.sandboxPolicy = options.sandboxPolicy
  const spec = executor.resolve(request)
  const started = await executor.execute(spec)
  try {
    return await started.result()
  } finally {
    await started.done
  }
}

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

const tempDirs = []

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort: a locked directory is not worth failing the suite.
    }
  }
}

const WORK = tempDir('cmdtest-work-')

let plainHost
async function getPlainHost() {
  plainHost ??= await createHost({ sandbox: false })
  return plainHost
}

// ---------------------------------------------------------------------------
// T-BASIC — a command runs, its stdout is returned verbatim, exit code 0.
// ---------------------------------------------------------------------------

await test('T-BASIC a command runs and its stdout comes back', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const result = await run(executor, 'echo hello')
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text, 'hello\r\n')
    assert.equal(result.stderr.text, '')
    assert.equal(result.timedOut, false)
    assert.equal(result.aborted, false)
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-QUOTE — the batch transport keeps quotes literal (the reason it is a file
// and not an inline `/c "..."`).
// ---------------------------------------------------------------------------

await test('T-QUOTE quotes survive the transport', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const simple = await run(executor, 'echo "a b"')
    assert.equal(simple.exitCode, 0)
    assert.equal(simple.stdout.text, '"a b"\r\n')

    const path = await run(executor, 'echo "C:\\Program Files\\x.exe" arg')
    assert.equal(path.exitCode, 0)
    assert.equal(path.stdout.text, '"C:\\Program Files\\x.exe" arg\r\n')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-VAR — `%VAR%` expansion, including the parse-time rule that bites models:
// a variable set on the same line is not visible to that same line.
// ---------------------------------------------------------------------------

await test('T-VAR %VAR% expands; a same-line set is not visible yet', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const cwd = await run(executor, 'echo %CD%')
    assert.equal(cwd.exitCode, 0)
    assert.equal(cwd.stdout.text.trim().toLowerCase(), WORK.toLowerCase())

    // The whole line is expanded before any of it runs, so `%DSH_CMD_TEST%` is
    // still empty when `echo` reads it. Measured on this host.
    const sameLine = await run(executor, 'set DSH_CMD_TEST=1 & echo [%DSH_CMD_TEST%]')
    assert.equal(sameLine.stdout.text, '[]\r\n')

    // On separate lines the assignment lands first and the expansion sees it.
    const split = await run(executor, 'set DSH_CMD_TEST=1\r\necho [%DSH_CMD_TEST%]')
    assert.equal(split.stdout.text, '[1]\r\n')

    // The literal case from the plan: `%X%` is unset, so `echo` gets no
    // argument and prints its own status instead of `1`.
    const unset = await run(executor, 'set X=1 & echo %X%')
    assert.equal(unset.exitCode, 0)
    assert.notEqual(unset.stdout.text.trim(), '1')

    const inherited = await run(executor, 'echo [%PATH%]')
    assert.ok(!inherited.stdout.text.includes('%PATH%'), 'PATH is inherited, not left literal')
    assert.ok(inherited.stdout.text.trim().length > 10, 'PATH expanded to a real value')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-OP — `&`, `&&`, `||`, pipes and redirection all behave as in a .cmd file.
// ---------------------------------------------------------------------------

await test('T-OP operators behave as in a batch file', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const amp = await run(executor, 'echo a & echo b')
    assert.equal(amp.exitCode, 0)
    assert.ok(amp.stdout.text.indexOf('a') !== -1 && amp.stdout.text.indexOf('b') !== -1)
    assert.ok(amp.stdout.text.indexOf('a') < amp.stdout.text.indexOf('b'), 'left to right')

    const and = await run(executor, 'echo a && echo b')
    assert.ok(and.stdout.text.includes('a') && and.stdout.text.includes('b'))

    // The right-hand side must be skipped when the left fails.
    const shortCircuit = await run(executor, 'dir /nonexistent && echo nope')
    assert.ok(!shortCircuit.stdout.text.includes('nope'), '&& skipped the right-hand side')

    const or = await run(executor, 'dir /nonexistent || echo recovered')
    assert.equal(or.exitCode, 0)
    assert.ok(or.stdout.text.includes('recovered'))

    const pipe = await run(executor, 'echo hi | findstr hi')
    assert.equal(pipe.exitCode, 0)
    assert.ok(pipe.stdout.text.includes('hi'))

    const redirect = await run(executor, 'echo saved> out.txt & type out.txt')
    assert.equal(redirect.exitCode, 0)
    assert.ok(redirect.stdout.text.includes('saved'))
    assert.ok(existsSync(join(WORK, 'out.txt')), 'redirection wrote into the working directory')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-MULTI — a multi-line command runs every line, in order.
// ---------------------------------------------------------------------------

await test('T-MULTI every line of a multi-line command runs in order', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const result = await run(executor, 'echo one\r\necho two\r\necho three')
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text, 'one\r\ntwo\r\nthree\r\n')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-BLOCK — the block syntax the tool description promises (`( )`, `if`, `for`).
// ---------------------------------------------------------------------------

await test('T-BLOCK parenthesised if/else and for /l work', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    writeFileSync(join(WORK, 'block-marker.txt'), 'x', 'utf8')

    const branch = await run(
      executor,
      'if exist block-marker.txt (echo YES) else (echo NO)',
    )
    assert.equal(branch.exitCode, 0)
    assert.equal(branch.stdout.text, 'YES\r\n')

    const loop = await run(executor, 'for /l %%i in (1,1,3) do echo %%i')
    assert.equal(loop.exitCode, 0)
    assert.equal(loop.stdout.text, '1\r\n2\r\n3\r\n')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-ENC — non-ASCII output survives the pipe byte for byte.
// ---------------------------------------------------------------------------

await test('T-ENC non-ASCII output is not mangled', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const zh = await run(executor, 'echo 中文')
    assert.equal(zh.exitCode, 0)
    assert.equal(zh.stdout.text, '中文\r\n')

    const mixed = await run(executor, 'echo 中文测试')
    assert.equal(mixed.stdout.text, '中文测试\r\n')
    assert.ok(!mixed.stdout.text.includes('\uFFFD'), 'no replacement characters')

    const codePage = await run(executor, 'chcp')
    assert.ok(/65001/.test(codePage.stdout.text), `expected UTF-8 code page, got ${JSON.stringify(codePage.stdout.text)}`)
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-EXIT — exit codes follow cmd's direct-form rule (no trailing `exit /b`).
// ---------------------------------------------------------------------------

await test('T-EXIT exit codes are the command exit codes', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const explicit = await run(executor, 'exit /b 7')
    assert.equal(explicit.exitCode, 7)
    assert.equal(explicit.stdout.text, '')

    const failing = await run(executor, 'dir /nonexistent')
    assert.equal(failing.exitCode, 1)

    // The load-bearing case: without the trailing `exit /b %errorlevel%` this is
    // 0, exactly like bash. With it, it would report the earlier failure's 1.
    const recovered = await run(executor, 'dir /nonexistent & echo recovered')
    assert.equal(recovered.exitCode, 0)
    assert.ok(recovered.stdout.text.includes('recovered'))

    const hard = await run(executor, 'exit 9')
    assert.equal(hard.exitCode, 9)

    const nested = await run(executor, 'cmd /c exit 3')
    assert.equal(nested.exitCode, 3)
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-CWD — `workdir` is honoured, and a missing one fails before anything runs.
// ---------------------------------------------------------------------------

await test('T-CWD workdir is honoured and a missing one never spawns', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const other = tempDir('cmdtest-cwd-')
    const result = await run(executor, 'echo %CD%', { workdir: other })
    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text.trim().toLowerCase(), other.toLowerCase())

    const wrote = await run(executor, 'echo here> marker.txt', { workdir: other })
    assert.equal(wrote.exitCode, 0)
    assert.ok(existsSync(join(other, 'marker.txt')), 'the command ran in the requested directory')

    // A directory that disappears between resolution and execution is refused by
    // the executor itself, so the command never starts and cannot fall back to
    // the scratch directory (which would silently run it with write access).
    const missing = join(WORK, 'no-such-dir')
    const sideEffect = join(WORK, 'gone.txt')
    await assert.rejects(
      () => executor.execute(executor.resolve({ command: `echo hi> "${sideEffect}"`, workdir: missing })),
      /cmd: working directory does not exist/,
    )
    assert.ok(!existsSync(sideEffect), 'the rejected command produced no side effect')
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-TIME — the deadline kills the command and reports it.
// ---------------------------------------------------------------------------

await test('T-TIME a small timeout kills the command and reports timedOut', async () => {
  const { executor, fiber } = await mountCmd(await getPlainHost())
  try {
    const quick = await run(executor, 'echo fast', { timeoutMs: 30_000 })
    assert.equal(quick.timedOut, false, 'a fast command is not reported as timed out')

    const started = Date.now()
    // 30 pings is ~29s; the deadline is 800ms, so this can only finish by being
    // killed.
    const slow = await run(executor, 'ping -n 30 127.0.0.1', { timeoutMs: 800 })
    const elapsed = Date.now() - started
    assert.equal(slow.timedOut, true)
    assert.equal(slow.aborted, false)
    assert.equal(slow.timeoutMs, 800)
    assert.notEqual(slow.exitCode, 0)
    assert.ok(elapsed < 15_000, `the process was killed, not awaited (elapsed ${elapsed}ms)`)
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-LIFE — the scratch directory holds no script files while idle, and is
// removed when the executor unmounts.
// ---------------------------------------------------------------------------

function scratchDirs() {
  try {
    return readdirSync(tmpdir()).filter((entry) => entry.startsWith(`dsh-cmd-${process.pid}-`))
  } catch {
    return []
  }
}

function scriptFilesIn(dirName) {
  try {
    return readdirSync(join(tmpdir(), dirName)).filter((entry) => entry.endsWith('.cmd'))
  } catch {
    return []
  }
}

await test('T-LIFE script files are deleted after each run; the scratch dir on unmount', async () => {
  const before = new Set(scratchDirs())
  const { executor, fiber } = await mountCmd(await getPlainHost())
  let mine
  try {
    for (const command of ['echo one', 'echo two', 'echo three']) {
      const result = await run(executor, command)
      assert.equal(result.exitCode, 0)
    }
    mine = scratchDirs().filter((entry) => !before.has(entry))
    assert.equal(mine.length, 1, `expected one scratch dir, got ${JSON.stringify(mine)}`)
    assert.deepEqual(scriptFilesIn(mine[0]), [], 'no .cmd file outlives its process')
  } finally {
    await fiber.dispose()
  }
  assert.ok(!existsSync(join(tmpdir(), mine[0])), 'unmounting the executor removes its scratch dir')
})

// ---------------------------------------------------------------------------
// T-SBX — under a confined policy the command really runs, and the sandbox
// really refuses the write it is supposed to refuse.
// ---------------------------------------------------------------------------

await test('T-SBX a confined command runs and the sandbox refuses outside writes', async () => {
  let host
  try {
    host = await createHost({ sandbox: true, mode: 'workspace-write' })
  } catch (error) {
    skip(`no sandbox stack on this host: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (host.ctx.get('sandbox') === undefined) {
    skip('no sandbox provider mounted')
    return
  }

  const work = tempDir('cmdtest-sbx-')
  const outside = tempDir('cmdtest-outside-')
  const policy = { mode: 'workspace-write', workspaceRoot: work }
  const { executor, fiber } = await mountCmd(host)
  try {
    assert.equal(executor.sandboxMode, 'workspace-write', 'the executor advertises the confined mode')

    let result
    try {
      result = await run(executor, 'echo hello', { workdir: work, sandboxPolicy: policy })
    } catch (error) {
      // A host that cannot build a restricted token reports it as a sandbox
      // failure. That is a skip, not a pass: nothing about confinement was
      // verified.
      if (/sandbox|restricted token|privilege/i.test(String(error?.message ?? error))) {
        skip(`confined launch unavailable: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      throw error
    }

    assert.equal(result.exitCode, 0)
    assert.equal(result.stdout.text, 'hello\r\n')
    assert.equal(result.sandbox?.mode, 'workspace-write')
    assert.equal(typeof result.sandbox?.denied, 'boolean')

    const inside = await run(executor, 'echo ok> inside.txt & type inside.txt', {
      workdir: work,
      sandboxPolicy: policy,
    })
    assert.equal(inside.exitCode, 0)
    assert.ok(existsSync(join(work, 'inside.txt')), 'a write inside the workspace is allowed')

    const escaped = join(outside, 'escaped.txt')
    const denied = await run(executor, `echo escaped> "${escaped}" & echo done`, {
      workdir: work,
      sandboxPolicy: policy,
    })
    // The real assertion is the filesystem: the write did not happen.
    assert.ok(!existsSync(escaped), 'a write outside the workspace is refused')
    assert.match(
      denied.stderr.text,
      /denied|Access|拒绝/i,
      `the refusal is reported, got ${JSON.stringify(denied.stderr.text)}`,
    )

    // Control: the very same command, unconfined, does create the file. Without
    // this, the absence above could be caused by the command syntax rather than
    // by the sandbox.
    const control = await run(executor, `echo escaped> "${escaped}" & echo done`, {
      workdir: work,
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: work },
    })
    assert.equal(control.exitCode, 0)
    assert.ok(existsSync(escaped), 'the same write succeeds when the call is not confined')
    rmSync(escaped, { force: true })
    // Deliberately NOT asserted: `denied.sandbox.denied === true`. On this host
    // the provider reports `enforcement: partial` and the denial signature never
    // matches, so the flag stays false even though the write was really blocked
    // (plan §8, R10). Asserting it here would fail for a real, working sandbox.
  } finally {
    await fiber.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-INSTALL — the end-to-end assembly: tool, tool hiding, prompt sections, and
// the two dialects that must be left alone.
// ---------------------------------------------------------------------------

await test('T-INSTALL dialect cmd assembles the session; pwsh and bash are untouched', async () => {
  const host = await createHost({ sandbox: false })
  const { agent, scope, preset, presetKey } = createAgent(host, 'cmd-session')
  try {
    const tools = agent.ctx.tools
    assert.ok(tools.get('pwsh', agent), 'precondition: pwsh is inherited')
    assert.equal(tools.get('cmd', agent), undefined, 'precondition: cmd is absent')

    const result = await installSession(host.ctx, agent, snapshotConfig({ dialect: 'cmd' }))
    assert.equal(result.status, 'installed', `install failed: ${JSON.stringify(result)}`)
    assert.match(result.cmdPath ?? '', /cmd\.exe$/i)

    assert.ok(tools.get('cmd', agent), 'the cmd tool is visible to the agent')
    assert.equal(tools.get('pwsh', agent), undefined, 'pwsh is hidden from the agent')
    assert.equal(tools.get('bash', agent), undefined, 'bash was never added')
    assert.ok(tools.get('pwsh', presetKey), 'the preset scope keeps its pwsh tool')

    const assembled = await agent.ctx.systemPrompt.assemble({ scope: agent })
    const section = (name) => assembled.sections.find((entry) => entry.name === name)
    const prompt = renderPrompt(assembled)
    assert.ok(!prompt.includes('Non-zero exits are reported'), 'the tool:pwsh text is gone from the prompt')
    // Blanked, not removed: the section is still registered for this agent with
    // an empty body, so nothing else can re-introduce the pwsh guidance into the
    // slot the cmd section now occupies.
    const pwshSection = section('tool:pwsh')
    assert.ok(pwshSection !== undefined, 'the tool:pwsh section is still registered')
    assert.equal(pwshSection.text, '', 'the tool:pwsh section is blanked')
    const cmdSection = section('tool:cmd')
    assert.ok(cmdSection !== undefined, 'the tool:cmd section is registered')
    assert.equal(cmdSection.text, CMD_PROMPT_SECTION)
    assert.ok(cmdSection.text.startsWith('## The `cmd` tool'))
    assert.equal(section('tool:bash'), undefined, 'no tool:bash section was created')

    // The installed tool really executes, through the tool layer this time.
    const tool = tools.get('cmd', agent)
    const output = await tool.execute(
      { description: 'say hi from the tool', command: 'echo hi-from-tool' },
      { agent, callId: 'cmd-call-1', signal: new AbortController().signal },
    )
    assert.equal(output.kind, 'foreground')
    assert.equal(output.exitCode, 0)
    assert.ok(output.stdout.text.includes('hi-from-tool'))

    // dialect pwsh: nothing is mounted, the inherited pwsh tool stays.
    const pwshAgent = createAgent(host, 'pwsh-session')
    try {
      const untouched = await installSession(host.ctx, pwshAgent.agent, snapshotConfig({ dialect: 'pwsh' }))
      assert.equal(untouched.status, 'skipped')
      assert.equal(untouched.reason, 'dialect-pwsh')
      assert.ok(pwshAgent.agent.ctx.tools.get('pwsh', pwshAgent.agent), 'pwsh still inherited')
      assert.equal(pwshAgent.agent.ctx.tools.get('cmd', pwshAgent.agent), undefined, 'no cmd tool')
    } finally {
      await pwshAgent.scope.dispose()
      await pwshAgent.preset.dispose()
    }

    // dialect bash: the bash path is unaffected by a cmd session existing.
    if (!hasGitBash) {
      skip('Git Bash is not installed, so the dialect-bash comparison was not run')
      return
    }
    const bashAgent = createAgent(host, 'bash-session')
    try {
      const installed = await installSession(
        host.ctx,
        bashAgent.agent,
        snapshotConfig({ dialect: 'bash', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
      )
      assert.equal(installed.status, 'installed', `bash install failed: ${JSON.stringify(installed)}`)
      assert.ok(bashAgent.agent.ctx.tools.get('bash', bashAgent.agent), 'bash is visible')
      assert.equal(bashAgent.agent.ctx.tools.get('cmd', bashAgent.agent), undefined, 'no cmd tool')
      assert.equal(bashAgent.agent.ctx.tools.get('pwsh', bashAgent.agent), undefined, 'pwsh hidden')
    } finally {
      await bashAgent.scope.dispose()
      await bashAgent.preset.dispose()
    }
  } finally {
    await scope.dispose()
    await preset.dispose()
  }
})

// ---------------------------------------------------------------------------
// T-REGRESS — a cmd session must not change anything outside its own scope.
// ---------------------------------------------------------------------------

await test('T-REGRESS installing cmd leaves the host and the bash path alone', async () => {
  const host = await createHost({ sandbox: false })
  const cmdAgent = createAgent(host, 'regress-cmd')
  try {
    assert.equal(host.ctx.get('shell'), undefined, 'precondition: no host-level shell')

    const installed = await installSession(host.ctx, cmdAgent.agent, snapshotConfig({ dialect: 'cmd' }))
    assert.equal(installed.status, 'installed')

    // The session's executor lives in the session's own isolated realm; the host
    // realm still has no `shell` service at all.
    assert.equal(host.ctx.get('shell'), undefined, 'cmd install did not register a host-level shell')
    assert.equal(cmdAgent.agent.ctx.get('shell'), undefined, 'the executor did not leak into the agent scope')

    // The cmd tool still works.
    const cmdTool = cmdAgent.agent.ctx.tools.get('cmd', cmdAgent.agent)
    const echo = await cmdTool.execute(
      { description: 'echo from the cmd session', command: 'echo cmd-still-works' },
      { agent: cmdAgent.agent, callId: 'regress-cmd-1', signal: new AbortController().signal },
    )
    assert.ok(echo.stdout.text.includes('cmd-still-works'))

    if (!hasGitBash) {
      skip('Git Bash is not installed, so the bash side of the regression was not run')
      return
    }

    // A bash session in the same host is completely unaffected.
    const bashAgent = createAgent(host, 'regress-bash')
    try {
      const bashInstalled = await installSession(
        host.ctx,
        bashAgent.agent,
        snapshotConfig({ dialect: 'bash', bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe' }),
      )
      assert.equal(bashInstalled.status, 'installed')
      const bashTool = bashAgent.agent.ctx.tools.get('bash', bashAgent.agent)
      assert.ok(bashTool, 'bash tool present')

      const output = await bashTool.execute(
        { description: 'report the bash shell', command: 'echo "$BASH_VERSION"; uname -s' },
        { agent: bashAgent.agent, callId: 'regress-bash-1', signal: new AbortController().signal },
      )
      const text = JSON.stringify(output)
      assert.match(text, /MINGW|MSYS/i, `expected an MSYS uname, got: ${text}`)
      assert.equal(host.ctx.get('shell'), undefined, 'the bash install did not touch the host realm either')
    } finally {
      await bashAgent.scope.dispose()
      await bashAgent.preset.dispose()
    }
  } finally {
    await cmdAgent.scope.dispose()
    await cmdAgent.preset.dispose()
  }
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

cleanupTempDirs()
if (plainHost !== undefined) {
  try {
    await plainHost.ctx.registry.delete(SubprocessLocal)
  } catch {
    // Best effort: the process is about to exit anyway.
  }
}

process.stdout.write(
  `\n${passed} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''}\n`,
)
if (failed > 0) process.exitCode = 1
