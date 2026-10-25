/**
 * Test-only entry point.
 *
 * `lib/index.js` is the cordis plugin: it exports `apply`/`name`/`inject` and
 * nothing else, because a plugin's export surface is part of its contract. The
 * integration test still needs the individual steps, so they are exposed here
 * and bundled separately. Nothing imports this file at runtime.
 */

export { installSession } from './replace.ts'
export type { InstallResult } from './replace.ts'
export { snapshotConfig } from './config.ts'
export type { ConfigSnapshot } from './config.ts'
export { GitBashExecutor } from './executor.ts'
export { discoverBash } from './discover.ts'
export { diagnosticPath, writeDiagnostic } from './diag.ts'
export { isMsysStartupDenial, planLaunch, MSYS_DENIAL_EXIT_CODES, MSYS_DENIAL_SIGNATURES } from './confined.ts'
export type { ConfinedPolicy, LaunchPlan } from './confined.ts'
// The cmd dialect: the executor is mounted by `installCmdSession`, but the tests
// also drive it directly to exercise the launch decision and the transport
// without going through a whole agent.
export { CmdExecutor, planCmdLaunch } from './cmd/executor.ts'
export type { CmdExecutorConfig } from './cmd/executor.ts'
export { discoverCmd } from './cmd/discover.ts'
export { ensureScratchDir, materializeCmd, renderCmdScript, scriptArgv, sweepStaleScripts } from './cmd/script.ts'
export { CMD_PROMPT_SECTION } from './cmd/prompt.ts'
export type { CmdConfinedPolicy, CmdLaunch, CmdLocation, CmdScript, CmdScriptOptions, CmdSource } from './cmd/types.ts'
export {
  cloneMinimalForGitBash,
  createVariantManager,
  formatPresetRows,
  MINIMAL_ID,
  parsePresetRows,
  resolveVariantSpec,
  VARIANT_ID,
} from './preset.ts'
export type { VariantSpec } from './preset.ts'
