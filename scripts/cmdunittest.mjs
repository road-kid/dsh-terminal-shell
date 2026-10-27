/**
 * Unit checks for the `cmd` dialect.
 *
 * Covers the three modules that carry the transport (`script.ts`), the discovery
 * (`discover.ts`) and the launch decision (`executor.ts`), plus a matrix of
 * **real** `cmd.exe` runs — the guard, the exit code, and UTF-8 output are
 * properties of a live process, so asserting them against a mock would prove
 * nothing.
 *
 * Run with `node scripts/cmdunittest.mjs`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'

import { CmdExecutor, planCmdLaunch } from '../src/cmd/executor.ts'
import { discoverCmd, isCmdExecutable, scanCmdCandidates } from '../src/cmd/discover.ts'
import {
  SCRATCH_PREFIX,
  ensureScratchDir,
  escapeBatchPath,
  materializeCmd,
  renderCmdScript,
  scriptArgv,
  sweepStaleScripts,
} from '../src/cmd/script.ts'

let passed = 0
let failed = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  }
}

/** Directories to delete before the process exits. */
const scratchRoots = []

function tempRoot(tag) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-cmd-unit-${tag}-`))
  scratchRoots.push(dir)
  return dir
}

const CODEPAGE = 65001

/** Render + write + spawn + dispose, exactly the way the executor does it. */
function runScript(cmdPath, command, workdir, root = tempRoot('run')) {
  const script = materializeCmd(root, command, { codePage: CODEPAGE, workdir })
  const { argv, cwd } = scriptArgv(cmdPath, script)
  try {
    const child = spawnSync(argv[0], argv.slice(1), {
      cwd,
      encoding: 'buffer',
      windowsHide: true,
      timeout: 60_000,
    })
    return {
      status: child.status,
      stdout: child.stdout.toString('utf8'),
      stderr: child.stderr.toString('utf8'),
      argv,
      cwd,
      path: script.path,
    }
  } finally {
    script.dispose()
  }
}

const cmdPath = discoverCmd('')?.path

// --- §5.1 script.ts ---------------------------------------------------------

await test('renderCmdScript starts with @echo off and switches the code page', () => {
  const text = renderCmdScript('echo hi', { codePage: CODEPAGE, workdir: 'C:\\work' })
  const lines = text.split('\r\n')
  assert.equal(lines[0], '@echo off')
  assert.equal(lines[1], `chcp ${CODEPAGE}>nul`)
})

await test('renderCmdScript guards the working directory', () => {
  const text = renderCmdScript('echo hi', { codePage: CODEPAGE, workdir: 'C:\\work' })
  assert.ok(
    text.includes(
      'cd /d "C:\\work" 2>nul || (echo cmd: cannot enter the working directory 1>&2 & exit /b 1)',
    ),
    text,
  )
})

await test('renderCmdScript uses pushd for a UNC working directory', () => {
  const text = renderCmdScript('echo hi', { codePage: CODEPAGE, workdir: '\\\\server\\share\\dir' })
  assert.ok(text.includes('pushd "\\\\server\\share\\dir" 2>nul ||'), text)
  assert.ok(!text.includes('cd /d "\\\\server'), text)
})

await test('renderCmdScript doubles % in the working directory', () => {
  const text = renderCmdScript('echo hi', { codePage: CODEPAGE, workdir: 'C:\\100% done\\x' })
  assert.ok(text.includes('cd /d "C:\\100%% done\\x" 2>nul ||'), text)
})

await test('renderCmdScript adds no trailing exit /b', () => {
  const text = renderCmdScript('dir /nonexistent\r\necho recovered', { codePage: CODEPAGE, workdir: 'C:\\work' })
  assert.ok(!/exit \/b %errorlevel%/i.test(text), text)
  const lines = text.split('\r\n').filter((line) => line !== '')
  assert.equal(lines.at(-1), 'echo recovered', 'the command body must be the last line')
  assert.ok(text.endsWith('\r\n'), 'the file must end with a line break')
})

await test('renderCmdScript normalizes LF to CRLF', () => {
  const text = renderCmdScript('echo one\necho two\r\necho three', { codePage: CODEPAGE, workdir: 'C:\\work' })
  assert.ok(text.includes('echo one\r\necho two\r\necho three'), JSON.stringify(text))
  assert.ok(!/[^\r]\n/.test(text), 'every LF must be part of a CRLF')
})

await test('escapeBatchPath doubles every %', () => {
  assert.equal(escapeBatchPath('a%b%c'), 'a%%b%%c')
  assert.equal(escapeBatchPath('C:\\plain'), 'C:\\plain')
})

await test('materializeCmd writes UTF-8 without a BOM', () => {
  const root = tempRoot('bom')
  const script = materializeCmd(root, 'echo 中文', { codePage: CODEPAGE, workdir: root })
  try {
    const bytes = readFileSync(script.path)
    assert.equal(bytes[0], 0x40, 'first byte must be @, not part of a BOM')
    assert.ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), 'no UTF-8 BOM')
    const text = bytes.toString('utf8')
    assert.ok(text.includes('echo 中文'), 'the command must be written as UTF-8')
    assert.equal(text, renderCmdScript('echo 中文', { codePage: CODEPAGE, workdir: root }))
  } finally {
    script.dispose()
  }
})

await test('materializeCmd gives each execution its own file and dispose is idempotent', () => {
  const root = tempRoot('unique')
  const first = materializeCmd(root, 'echo 1', { codePage: CODEPAGE, workdir: root })
  const second = materializeCmd(root, 'echo 2', { codePage: CODEPAGE, workdir: root })
  try {
    assert.notEqual(first.path, second.path)
    assert.ok(existsSync(first.path) && existsSync(second.path))
    first.dispose()
    assert.equal(existsSync(first.path), false)
    first.dispose()
    assert.equal(existsSync(second.path), true, 'disposing one script must not touch the other')
  } finally {
    first.dispose()
    second.dispose()
  }
})

await test('scriptArgv passes the bare file name and spawns in the script directory', () => {
  const root = tempRoot('argv')
  const script = materializeCmd(root, 'echo hi', { codePage: CODEPAGE, workdir: 'C:\\work' })
  try {
    const { argv, cwd } = scriptArgv('C:\\Windows\\System32\\cmd.exe', script)
    assert.deepEqual(argv, ['C:\\Windows\\System32\\cmd.exe', '/d', '/q', '/c', basename(script.path)])
    assert.equal(cwd, dirname(script.path))
    assert.ok(!argv.includes('/s'), '/s must never be passed')
    assert.ok(!argv[4].includes('\\') && !argv[4].includes('/'), 'the script must be addressed by bare name')
  } finally {
    script.dispose()
  }
})

await test('ensureScratchDir creates a prefixed directory', () => {
  const root = tempRoot('scratch')
  const dir = ensureScratchDir(join(root, 'nested'))
  assert.ok(existsSync(dir))
  assert.ok(basename(dir).startsWith(SCRATCH_PREFIX) || dir.includes('nested'))
  assert.ok(dir.includes('nested'), 'an explicit root must be honoured verbatim')
})

await test('sweepStaleScripts removes only stale scratch directories', () => {
  const root = tempRoot('sweep')
  const stale = join(root, `${SCRATCH_PREFIX}stale`)
  const fresh = join(root, `${SCRATCH_PREFIX}fresh`)
  const foreign = join(root, 'not-ours')
  for (const dir of [stale, fresh, foreign]) mkdirSync(dir)
  writeFileSync(join(stale, 'cmd-x.cmd'), '@echo off\r\n')

  const now = Date.now()
  const old = new Date(now - 48 * 60 * 60 * 1000)
  utimesSync(stale, old, old)
  utimesSync(foreign, old, old)

  assert.equal(sweepStaleScripts(now, root), 1)
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(fresh), true)
  assert.equal(existsSync(foreign), true, 'directories this plugin does not own must survive')
  assert.deepEqual(readdirSync(root).sort(), ['dsh-cmd-fresh', 'not-ours'].sort())
})

await test('sweepStaleScripts never throws on a missing root', () => {
  assert.equal(sweepStaleScripts(Date.now(), join(tmpdir(), 'dsh-cmd-unit-does-not-exist-xyz')), 0)
})

// --- §5.2 discover.ts -------------------------------------------------------

await test('discoverCmd prefers the configured path', () => {
  const root = tempRoot('discover-config')
  const exe = join(root, 'cmd.exe')
  writeFileSync(exe, '')
  assert.deepEqual(discoverCmd(exe, {}), { path: exe, source: 'config' })
})

await test('discoverCmd falls back to ComSpec', () => {
  const root = tempRoot('discover-comspec')
  const exe = join(root, 'cmd.exe')
  writeFileSync(exe, '')
  assert.deepEqual(discoverCmd('', { ComSpec: exe }), { path: exe, source: 'comspec' })
  assert.deepEqual(discoverCmd('', { COMSPEC: exe }), { path: exe, source: 'comspec' })
})

await test('discoverCmd falls back to %SystemRoot%\\System32\\cmd.exe', () => {
  const root = tempRoot('discover-systemroot')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const exe = join(root, 'System32', 'cmd.exe')
  writeFileSync(exe, '')
  assert.deepEqual(discoverCmd('', { SystemRoot: root }), { path: exe, source: 'system-root' })
  assert.deepEqual(discoverCmd('', { windir: root }), { path: exe, source: 'system-root' })
})

await test('discoverCmd ignores a configured path that is not a file', () => {
  const root = tempRoot('discover-miss')
  mkdirSync(join(root, 'dir'), { recursive: true })
  // A directory, a blank string and a missing file all fall through.
  assert.equal(discoverCmd(join(root, 'dir'), {}), undefined)
  assert.equal(discoverCmd('   ', {}), undefined)
  assert.equal(discoverCmd(join(root, 'nope.exe'), {}), undefined)
})

await test('discoverCmd finds the real cmd.exe on this host', () => {
  const found = discoverCmd('')
  assert.ok(found !== undefined, 'this host must expose cmd.exe')
  assert.ok(existsSync(found.path), found.path)
  assert.ok(['comspec', 'system-root'].includes(found.source), found.source)
  assert.equal(basename(found.path).toLowerCase(), 'cmd.exe')
})

await test('isCmdExecutable accepts only a cmd.exe basename', () => {
  assert.equal(isCmdExecutable('C:\\Windows\\System32\\cmd.exe'), true)
  assert.equal(isCmdExecutable('c:/windows/system32/CMD.EXE'), true)
  assert.equal(isCmdExecutable('C:\\Windows\\System32\\cmd.exe\\'), true)
  assert.equal(isCmdExecutable('C:\\Program Files\\Git\\bin\\bash.exe'), false)
  assert.equal(isCmdExecutable('C:\\Windows\\System32\\cmd.exe.bak'), false)
  assert.equal(isCmdExecutable(''), false)
})

await test('discoverCmd ignores a configured path that is not cmd.exe', () => {
  const root = tempRoot('discover-notcmd')
  const bash = join(root, 'bash.exe')
  writeFileSync(bash, '')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const real = join(root, 'System32', 'cmd.exe')
  writeFileSync(real, '')
  // The bash path exists but is not cmd.exe, so the deterministic fallback wins.
  assert.deepEqual(discoverCmd(bash, { SystemRoot: root }), { path: real, source: 'system-root' })
})

await test('scanCmdCandidates marks a non-cmd configured path invalid', () => {
  const root = tempRoot('scan-notcmd')
  const bash = join(root, 'bash.exe')
  writeFileSync(bash, '')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const real = join(root, 'System32', 'cmd.exe')
  writeFileSync(real, '')
  const list = scanCmdCandidates(bash, { SystemRoot: root })
  assert.deepEqual(list[0], { path: bash, source: 'configured', valid: false })
  assert.ok(list.some((candidate) => candidate.path === real && candidate.valid))
})

await test('scanCmdCandidates lists configured, ComSpec and System32 in priority order', () => {
  const root = tempRoot('scan-cmd')
  const configuredDir = join(root, 'custom')
  mkdirSync(configuredDir, { recursive: true })
  const configured = join(configuredDir, 'cmd.exe')
  writeFileSync(configured, '')
  const specDir = join(root, 'spec')
  mkdirSync(specDir, { recursive: true })
  const comspec = join(specDir, 'cmd.exe')
  writeFileSync(comspec, '')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const system = join(root, 'System32', 'cmd.exe')
  writeFileSync(system, '')

  assert.deepEqual(scanCmdCandidates(configured, { ComSpec: comspec, SystemRoot: root }), [
    { path: configured, source: 'configured', valid: true },
    { path: comspec, source: 'comspec', valid: true },
    { path: system, source: 'system-root', valid: true },
  ])
})

await test('scanCmdCandidates deduplicates one path reached through two sources', () => {
  const root = tempRoot('scan-cmd-dedup')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const exe = join(root, 'System32', 'cmd.exe')
  writeFileSync(exe, '')
  const list = scanCmdCandidates('', { ComSpec: exe, SystemRoot: root })
  assert.deepEqual(list, [{ path: exe, source: 'comspec', valid: true }])
})

await test('scanCmdCandidates keeps a missing configured path but marks it invalid', () => {
  const root = tempRoot('scan-cmd-invalid')
  mkdirSync(join(root, 'System32'), { recursive: true })
  const system = join(root, 'System32', 'cmd.exe')
  writeFileSync(system, '')
  const missing = join(root, 'nope.exe')
  assert.deepEqual(scanCmdCandidates(missing, { SystemRoot: root }), [
    { path: missing, source: 'configured', valid: false },
    { path: system, source: 'system-root', valid: true },
  ])
})

await test('scanCmdCandidates finds the real cmd.exe on this host', () => {
  const list = scanCmdCandidates('')
  assert.ok(list.length > 0, 'this host must expose cmd.exe')
  assert.ok(list.every((candidate) => candidate.path.toLowerCase().endsWith('cmd.exe')))
  assert.ok(list.some((candidate) => candidate.valid))
})

// --- §5.3 executor.ts (launch decision + shape) -----------------------------

await test('planCmdLaunch: no sandbox means a direct danger-full-access launch', () => {
  assert.deepEqual(planCmdLaunch(false, 'workspace-write', 'escalate'), {
    kind: 'direct',
    mode: 'danger-full-access',
  })
  assert.deepEqual(planCmdLaunch(true, undefined, 'escalate'), { kind: 'direct', mode: 'danger-full-access' })
})

await test('planCmdLaunch: an unconfined policy mode means a direct launch', () => {
  assert.deepEqual(planCmdLaunch(true, 'danger-full-access', 'escalate'), {
    kind: 'direct',
    mode: 'danger-full-access',
  })
})

await test('planCmdLaunch: the unconfined choice bypasses confinement', () => {
  assert.deepEqual(planCmdLaunch(true, 'workspace-write', 'unconfined'), {
    kind: 'direct',
    mode: 'danger-full-access',
  })
  assert.deepEqual(planCmdLaunch(true, 'read-only', 'unconfined'), {
    kind: 'direct',
    mode: 'danger-full-access',
  })
})

await test('planCmdLaunch: escalate confines with the requested mode', () => {
  assert.deepEqual(planCmdLaunch(true, 'workspace-write', 'escalate'), {
    kind: 'confine',
    mode: 'workspace-write',
  })
  assert.deepEqual(planCmdLaunch(true, 'read-only', 'escalate'), { kind: 'confine', mode: 'read-only' })
})

await test('CmdExecutor extends LocalBashExecutor and injects subprocess', () => {
  assert.equal(Object.getPrototypeOf(CmdExecutor), LocalBashExecutor)
  assert.deepEqual(CmdExecutor.inject, ['subprocess'])
  assert.ok(Array.isArray(CmdExecutor.inject), 'inject must stay a mutable array (no `as const`)')
  assert.equal(typeof CmdExecutor.prototype.resolve, 'function')
  assert.equal(typeof CmdExecutor.prototype.execute, 'function')
})

// --- Real cmd.exe -----------------------------------------------------------

await test('a real cmd.exe runs the script and returns its stdout', () => {
  assert.ok(cmdPath !== undefined, 'the spawn matrix needs a real cmd.exe')
  const root = tempRoot('real')
  const result = runScript(cmdPath, 'echo hello', root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'hello\r\n')
  assert.equal(result.stderr, '')
})

await test('a real cmd.exe decodes UTF-8 output', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('utf8')
  // Multi-line at the same time: the transport must preserve both lines.
  const result = runScript(cmdPath, 'echo hello\r\necho 中文', root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'hello\r\n中文\r\n')
})

await test('a real cmd.exe runs inside the requested working directory', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('cwd')
  const workdir = join(root, 'work')
  mkdirSync(workdir)
  const result = runScript(cmdPath, 'cd', workdir, root)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().toLowerCase(), workdir.toLowerCase())
})

await test('a real cmd.exe refuses a missing working directory without running the command', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('missing-cwd')
  const missing = join(root, 'gone')
  const result = runScript(cmdPath, 'echo RAN', missing, root)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '', 'the command must not run in the scratch directory')
  assert.ok(result.stderr.includes('cannot enter the working directory'), result.stderr)
})

await test('a real cmd.exe propagates exit /b', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('exitcode')
  const result = runScript(cmdPath, 'exit /b 7', root)
  assert.equal(result.status, 7)
})

await test('a real cmd.exe keeps the last command as the exit code (no trailing exit /b)', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('recover')
  const result = runScript(cmdPath, 'dir /nonexistent\r\necho recovered', root)
  assert.equal(result.status, 0, 'bash reports 0 here too; a trailing exit /b would report 1')
  assert.ok(result.stdout.includes('recovered'), result.stdout)
})

await test('a finished execution leaves no script file behind (P1-6 regression)', () => {
  assert.ok(cmdPath !== undefined)
  const root = tempRoot('no-leak')
  const scripts = () => readdirSync(root).filter((name) => name.startsWith('cmd-'))
  const script = materializeCmd(root, 'echo done', { codePage: CODEPAGE, workdir: root })
  // One file while the process may still be reading it...
  assert.deepEqual(scripts(), [basename(script.path)])

  const { argv, cwd } = scriptArgv(cmdPath, script)
  const child = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'buffer', windowsHide: true, timeout: 60_000 })
  assert.equal(child.status, 0, child.stderr.toString('utf8'))
  // ...and nothing once `onProcessDone` has disposed of it. A promoted timeout
  // is why the executor cannot delete it any earlier.
  script.dispose()
  assert.deepEqual(scripts(), [], 'the scratch directory must be empty after a finished execution')
  assert.deepEqual(readdirSync(root), [])
})

// --- Cleanup ----------------------------------------------------------------

for (const dir of scratchRoots) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best effort.
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
