// Evidence probe for docs/PLAN-cmd-dialect.md (v3, appendix A).
//
// Compares the two ways of handing a .cmd script to cmd.exe:
//   A. absolute path on the command line
//   B. bare file name, with the scratch directory as the child's cwd
// over directory names containing & ( ) ^ , ; % and !. Also checks /q vs
// `echo on` and the exit-code semantics of the direct form.
//
// Run: node docs/probes/cmd-transport.mjs   (Windows only)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BOM = ''
const w = (p, s) => writeFileSync(p, s, 'utf8')
const run = (argv, opts = {}) => spawnSync('cmd.exe', argv, { windowsHide: true, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...opts })
const show = (label, r) => {
  const out = r.stdout?.toString('utf8').trim() ?? ''
  const err = r.stderr?.toString('utf8').trim() ?? ''
  console.log(`${label} | status=${r.status} | out=${JSON.stringify(out)} | err=${JSON.stringify(err)}`)
}

// --- P1: 危险字符目录名下的两种形态 ---
const nasty = ['a&b', 'a(b)', 'a^b', 'a,b;c', 'a!b', 'x%TEMP%y', 'a b']
for (const name of nasty) {
  const root = join(tmpdir(), 'pr-' + name.replace(/[\/:*?"<>|]/g, '_'))
  try { mkdirSync(root, { recursive: true }) } catch (e) { console.log(`mkdir fail ${name}: ${e.code}`); continue }
  const script = join(root, 'cmd-x.cmd')
  w(script, '@echo off\r\nchcp 65001>nul\r\necho OK_FROM_SCRIPT\r\n')
  const abs = run(['/d', '/q', '/c', script])
  const bare = run(['/d', '/q', '/c', 'cmd-x.cmd'], { cwd: root })
  show(`ABS  [${name}]`, abs)
  show(`BARE [${name}]`, bare)
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}

// --- P2: /q 与脚本内 echo on ---
{
  const root = mkdtempSync(join(tmpdir(), 'pr-echo-'))
  const s1 = join(root, 'e1.cmd')
  w(s1, '@echo off\r\necho on\r\necho A\r\necho B\r\n')
  show('ECHO-ON  /q', run(['/d', '/q', '/c', s1]))
  show('ECHO-ON  no-q', run(['/d', '/c', s1]))
  rmSync(root, { recursive: true, force: true })
}

// --- P3: cd /d 失败处理 ---
{
  const root = mkdtempSync(join(tmpdir(), 'pr-cd-'))
  const s = join(root, 'c1.cmd')
  w(s, '@echo off\r\nchcp 65001>nul\r\ncd /d "Z:\nope\nope" 2>nul || (echo cmd: cannot enter working dir 1>&2 & exit /b 1)\r\necho SHOULD_NOT_RUN\r\n')
  show('CD-FAIL', run(['/d', '/q', '/c', 'c1.cmd'], { cwd: root }))
  const s2 = join(root, 'c2.cmd')
  w(s2, '@echo off\r\nchcp 65001>nul\r\ncd /d "C:\\" 2>nul || (echo nope 1>&2 & exit /b 1)\r\necho CD_OK %CD%\r\n')
  show('CD-OK  ', run(['/d', '/q', '/c', 'c2.cmd'], { cwd: root }))
  rmSync(root, { recursive: true, force: true })
}

// --- P4: 裸名形态 + 脚本内 cd 到含空格/% 的 workdir ---
{
  const scratch = mkdtempSync(join(tmpdir(), 'pr-scratch-'))
  const workdir = join(tmpdir(), 'pr wd x%TEMP%y')
  mkdirSync(workdir, { recursive: true })
  const s = join(scratch, 'cmd-y.cmd')
  const esc = workdir.replace(/%/g, '%%')
  w(s, `@echo off\r\nchcp 65001>nul\r\ncd /d "${esc}" 2>nul || (echo cd fail 1>&2 & exit /b 1)\r\necho CD=%CD%\r\necho 中文\r\n`)
  show('BARE+CD', run(['/d', '/q', '/c', 'cmd-y.cmd'], { cwd: scratch }))
  rmSync(scratch, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
}

// --- P5: 退出码（无尾部 exit /b） ---
{
  const root = mkdtempSync(join(tmpdir(), 'pr-exit-'))
  for (const [label, body] of [
    ['exit /b 7', 'exit /b 7\r\n'],
    ['dir /nonexistent', 'dir /nonexistent\r\n'],
    ['dir-bad then echo', 'dir /nonexistent\r\necho recovered\r\n'],
  ]) {
    const s = join(root, 'x.cmd')
    w(s, '@echo off\r\n' + body)
    show(`EXIT[${label}]`, run(['/d', '/q', '/c', 'x.cmd'], { cwd: root }))
  }
  rmSync(root, { recursive: true, force: true })
}
