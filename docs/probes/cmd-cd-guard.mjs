// Evidence probe for docs/PLAN-cmd-dialect.md (v3, appendix A).
//
// Shows that an unguarded `cd /d "<missing>"` lets the rest of the batch file
// run anyway in the scratch directory (exit 0, silently), while the guarded
// form `cd /d "..." 2>nul || (echo ... 1>&2 & exit /b 1)` stops with exit 1.
//
// Run: node docs/probes/cmd-cd-guard.mjs   (Windows only)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'pc-'))
const run = (args, cwd) => spawnSync('cmd.exe', args, { windowsHide: true, encoding: 'buffer', cwd, maxBuffer: 1 << 24 })
const show = (l, r) => console.log(`${l} | status=${r.status} | out=${JSON.stringify(r.stdout.toString('utf8').trim())} | err=${JSON.stringify(r.stderr.toString('utf8').trim())}`)

const BAD = 'C:/__no_such_dir__/x'
const GOOD = 'C:/'
const variants = {
  'A cd || (echo & exit)': (p) => `cd /d "${p}" 2>nul || (echo cd-failed 1>&2 & exit /b 1)`,
  'B cd then if errorlevel': (p) => `cd /d "${p}" 2>nul\r\nif errorlevel 1 (\r\n  echo cd-failed 1>&2\r\n  exit /b 1\r\n)`,
  'C cd then if errorlevel 1l': (p) => `cd /d "${p}" 2>nul\r\nif errorlevel 1 exit /b 1`,
  'D no guard': (p) => `cd /d "${p}" 2>nul`,
  'E pushd || (...)': (p) => `pushd "${p}" 2>nul || (echo cd-failed 1>&2 & exit /b 1)`,
  'F cd && ok || bad': (p) => `cd /d "${p}" 2>nul && (echo entered) || (echo cd-failed 1>&2 & exit /b 1)`,
}
for (const [label, mk] of Object.entries(variants)) {
  for (const [tag, p] of [['BAD ', BAD], ['GOOD', GOOD]]) {
    const f = join(root, 'g.cmd')
    writeFileSync(f, `@echo off\r\nchcp 65001>nul\r\n${mk(p)}\r\necho RAN %CD%\r\n`, 'utf8')
    show(`${tag} ${label}`, run(['/d', '/q', '/c', 'g.cmd'], root))
  }
}
rmSync(root, { recursive: true, force: true })
