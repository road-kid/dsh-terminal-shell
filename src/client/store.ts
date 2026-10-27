import { fetchCandidates, fetchState } from './api.ts'
import type { CmdConfinedPolicy } from '../cmd/types.ts'
import type { ConfinedPolicy } from '../confined.ts'
import type { MinimalMode, VariantStatus } from '../shared/protocol.ts'
import type { ConfigFormLike, FieldOp, FormSnapshot, TerminalToolValues, Translate } from './types.ts'

/**
 * Row state machine.
 *
 * Three rules shape this file, and they are all about *not* surprising the user:
 *
 * 1. **The plugin never switches the tool by itself.** `dialect` is written only
 *    when a choice is made; the value shown otherwise comes from the Host (the
 *    schema default is `pwsh`). Mounting performs no scan and no write.
 * 2. **Discovery is a consequence of choosing a shell.** `/discover` runs when
 *    the user switches the terminal kind to `bash` or `cmd`; the chosen path
 *    (and, for bash, the usable list) are persisted together. There is no
 *    separate "detect" button.
 * 3. **An existing usable path is never rewritten.** The sweep replaces the
 *    selection only when the current one is not among the usable candidates.
 *
 * `/state` is read once on mount and never scans, so opening Settings stays
 * instant even on a machine with many candidate roots.
 */

/** Which terminal tool a session gets. Mirrors `Dialect` in the wire protocol. */
export type Dialect = 'pwsh' | 'bash' | 'cmd'

export type { MinimalMode, VariantStatus }

/** Variant state as the row renders it. */
export interface VariantInfo {
  readonly status: VariantStatus
  readonly id: string
  readonly refs: number
  readonly reason?: string | undefined
}

/** Coarse lifecycle of the row. */
export type RowStatus = 'loading' | 'hidden' | 'ready'

/** Everything the row renders from. */
export interface RowState {
  readonly status: RowStatus
  readonly platform: string
  readonly dialect: Dialect
  readonly confinedPolicy: ConfinedPolicy
  readonly minimalMode: MinimalMode
  readonly variant: VariantInfo
  readonly bashPath: string
  readonly savedCandidates: readonly string[]
  readonly scanned: readonly string[]
  /** Candidates found by the last cmd sweep (in-memory only; resolution is deterministic). */
  readonly cmdScanned: readonly string[]
  /** Explicit `cmd.exe`, or `''` to let the Host resolve it. */
  readonly cmdPath: string
  /** Console code page the generated batch file switches to. */
  readonly cmdCodePage: number
  /** Sandbox policy for a cmd launch; only consulted under `dialect === 'cmd'`. */
  readonly cmdConfinedPolicy: CmdConfinedPolicy
  readonly writable: boolean
  readonly settingsAvailable: boolean
  readonly supported: boolean
  readonly unsupportedReason?: string | undefined
  readonly discovering: boolean
  readonly saving: boolean
  readonly error?: string | undefined
  readonly notice?: string | undefined
}

/** Minimal observable store (the row reads it through `useSyncExternalStore`). */
export interface Store<T> {
  getState(): T
  subscribe(listener: () => void): () => void
  setState(patch: Partial<T>): void
}

/** What the component drives. */
export interface RowController {
  readonly store: Store<RowState>
  /** Read `/state` and start following the form; returns the disposer. */
  start(): () => void
  setDialect(dialect: Dialect): void
  setConfinedPolicy(policy: ConfinedPolicy): void
  setMinimalMode(mode: MinimalMode): void
  setBashPath(path: string): void
  setCmdPath(path: string): void
  setCmdCodePage(codePage: number): void
  setCmdConfinedPolicy(policy: CmdConfinedPolicy): void
  /** Discover the executable for `dialect` (defaults to the current dialect). */
  discover(dialect?: Dialect, options?: { keepError?: boolean }): void
}

/** Code page the batch file switches to unless the user says otherwise. */
export const DEFAULT_CMD_CODE_PAGE = 65001

/**
 * Delay before the single retry of a failed discovery request.
 *
 * A settings write can make the Host re-apply the plugin entry, which briefly
 * detaches its `/discover` route. Without a retry the first switch of a session
 * could land in that gap and render an empty row, which reads as "nothing was
 * found"; one short retry turns that into a blip.
 */
const DISCOVERY_RETRY_MS = 120

/** Initial state: nothing known yet, and the default keeps sessions on pwsh. */
export const INITIAL_ROW_STATE: RowState = {
  status: 'loading',
  platform: '',
  dialect: 'pwsh',
  confinedPolicy: 'unconfined',
  minimalMode: 'oneshot',
  variant: { status: 'absent', id: 'minimal-gitbash', refs: 0 },
  bashPath: '',
  savedCandidates: [],
  scanned: [],
  cmdScanned: [],
  cmdPath: '',
  cmdCodePage: DEFAULT_CMD_CODE_PAGE,
  cmdConfinedPolicy: 'escalate',
  writable: false,
  settingsAvailable: false,
  supported: false,
  discovering: false,
  saving: false,
}

/** Shallow equality over own enumerable keys. */
function shallowEqual<T extends object>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => Object.is(Reflect.get(left, key), Reflect.get(right, key)))
}

/**
 * Create a store that only replaces its state object when a value actually
 * changed — `useSyncExternalStore` re-renders on every identity change, so a
 * no-op `setState` must not allocate.
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState(patch) {
      const next = { ...state, ...patch }
      if (shallowEqual(state, next)) return
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Comparison key for a bash path: separators, trailing slash and case folded. */
function pathKey(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/** Whether two paths point at the same executable. */
export function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

/**
 * Whether a text looks like a `cmd.exe` path.
 *
 * An empty string is valid (it means "let the Host resolve"). A named override
 * must be a `cmd.exe`: the only legal override is a copy of Command Prompt, and
 * accepting e.g. `bash.exe` here is how a corrupted config turns every `cmd`
 * session into a wrongly-framed Git Bash launch.
 */
export function looksLikeCmd(path: string): boolean {
  const trimmed = path.trim()
  if (trimmed === '') return true
  const base = trimmed.replace(/[\\/]+$/, '').slice(Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1)
  return base.toLowerCase() === 'cmd.exe'
}

/** Every path worth offering in the picker, deduplicated, in priority order. */
export function knownPaths(state: RowState): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of [state.bashPath, ...state.scanned, ...state.savedCandidates]) {
    const trimmed = candidate.trim()
    if (trimmed === '') continue
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** Every `cmd.exe` worth offering in the picker, deduplicated, current first. */
export function knownCmdPaths(state: RowState): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of [looksLikeCmd(state.cmdPath) ? state.cmdPath : '', ...state.cmdScanned]) {
    const trimmed = candidate.trim()
    if (trimmed === '') continue
    const key = pathKey(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** `Error`-ish values to a one-line message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A failed `/state` or `/discover` call, framed by the row's own sentence. */
function requestError(translate: Translate, error: unknown): string {
  return translate('row.requestFailed', { detail: messageOf(error) })
}

/** Narrow a wire value to the two legal policies, defaulting to `unconfined`. */
export function normalizeConfinedPolicy(value: unknown): ConfinedPolicy {
  return value === 'escalate' ? 'escalate' : 'unconfined'
}

/**
 * Narrow a wire value to the three legal dialects, defaulting to `pwsh`.
 *
 * `pwsh` is the safe fallback for the same reason it is the schema default:
 * an unreadable profile value must leave the platform's own terminal tool in
 * place rather than silently switching the session to a different shell.
 */
export function normalizeDialect(value: unknown): Dialect {
  return value === 'bash' || value === 'cmd' ? value : 'pwsh'
}

/**
 * Narrow a wire value to the two legal cmd policies, defaulting to `escalate`.
 *
 * The fallback mirrors `readCmdConfinedPolicy` in `src/config.ts`, which goes
 * the *other* way from `normalizeConfinedPolicy`: dropping the sandbox is the
 * riskier mistake, so an unknown value stays confined.
 */
export function normalizeCmdConfinedPolicy(value: unknown): CmdConfinedPolicy {
  return value === 'unconfined' ? 'unconfined' : 'escalate'
}

/** Read a code page, falling back to UTF-8 for anything that is not a positive integer. */
export function normalizeCodePage(value: unknown): number {
  const parsed = Math.trunc(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CMD_CODE_PAGE
}

/** Narrow a wire value to the three legal minimal modes, defaulting to `oneshot`. */
export function normalizeMinimalMode(value: unknown): MinimalMode {
  return value === 'leave' || value === 'variant' ? value : 'oneshot'
}

/**
 * Build the controller for one mounted row.
 *
 * @param scope - the entry's `configForms` form, or `undefined` when the Host
 *   settings service is absent (the row then renders read-only with an
 *   explanation instead of pretending to save).
 * @param translate - locale-bound `t`.
 */
export function createRowController(
  scope: ConfigFormLike<TerminalToolValues> | undefined,
  translate: Translate,
): RowController {
  const store = createStore<RowState>(INITIAL_ROW_STATE)

  /** Whether the form has delivered a value at least once. */
  let settingsReady = false

  /** Mirror the form's snapshot into the row state. */
  const syncSettings = (): void => {
    if (scope === undefined) return
    const snapshot: FormSnapshot<TerminalToolValues> = scope.getSnapshot()
    const value = snapshot.value
    if (value !== undefined) settingsReady = true
    const previous = store.getState()
    // While one of our writes is still queued (or a discovery that will write is
    // in flight) the form's next snapshot still carries the *previous* paths:
    // the Host has not folded the write in yet. Folding that stale empty value
    // back in would blank the optimistic path the user is looking at — on the
    // very first switch it looks like nothing was found. Keep the local value
    // until the queue settles; the final snapshot then agrees with it.
    const keepOptimistic = previous.saving || previous.discovering
    const incomingBash = value?.bashPath ?? ''
    const incomingCmd = looksLikeCmd(value?.cmdPath ?? '') ? (value?.cmdPath ?? '') : ''
    store.setState({
      writable: snapshot.writable && snapshot.status === 'ready',
      ...(value === undefined
        ? {}
        : {
            dialect: normalizeDialect(value.dialect),
            confinedPolicy: normalizeConfinedPolicy(value.confinedPolicy),
            minimalMode: normalizeMinimalMode(value.minimalMode),
            bashPath: keepOptimistic && incomingBash === '' ? previous.bashPath : incomingBash,
            savedCandidates: value.bashCandidates ?? [],
            cmdPath: keepOptimistic && incomingCmd === '' ? previous.cmdPath : incomingCmd,
            cmdCodePage: normalizeCodePage(value.cmdCodePage),
            cmdConfinedPolicy: normalizeCmdConfinedPolicy(value.cmdConfinedPolicy),
          }),
    })
  }

  /** Persist a batch of field writes, surfacing the outcome in the row. */
  const write = (ops: readonly FieldOp[], keepError = false): void => {
    const form = scope
    if (form === undefined) {
      store.setState({ saving: false, error: translate('row.unavailable') })
      return
    }
    // One retry on a refusal. The form fence is a revision, and a queued
    // successor can be refused once while the shared mirror catches up; the
    // refusal path has already reloaded that mirror, so the retry carries a
    // fresh revision. A real denial (read-only Host) fails again and is shown.
    const attempt = (isRetry: boolean): void => {
      store.setState({ saving: true })
      void form
        .mutate(ops)
        .then((accepted) => {
          if (accepted === false && !isRetry) {
            attempt(true)
            return
          }
          store.setState({
            saving: false,
            ...(accepted === false
              ? { error: translate('row.rejected') }
              : keepError
                ? {}
                : { error: undefined }),
          })
        })
        .catch((error: unknown) => {
          store.setState({ saving: false, error: translate('row.saveFailed', { message: messageOf(error) }) })
        })
    }
    attempt(false)
  }

  const setDialect = (dialect: Dialect): void => {
    // Optimistic: the chip must feel instant; a rejection restores the value on
    // the next form snapshot and shows an error.
    store.setState({ dialect, error: undefined, notice: undefined })
    const form = scope
    if (form === undefined) {
      store.setState({ error: translate('row.unavailable') })
      return
    }
    // Same one-retry rule as `write`: the first write of a session is the most
    // likely to meet a stale revision fence.
    const persist = (isRetry: boolean): void => {
      store.setState({ saving: true })
      void form
        .mutate([{ op: 'set', path: ['dialect'], value: dialect }])
        .then((accepted) => {
          if (accepted === false && !isRetry) {
            persist(true)
            return
          }
          store.setState({
            saving: false,
            ...(accepted === false ? { error: translate('row.rejected') } : { error: undefined }),
          })
          // Discovery is an independent read, so it runs even when the save was
          // refused: a raced or rejected first write must never leave the row
          // with no path. `pwsh` has nothing to discover.
          if (dialect !== 'pwsh') {
            // A refused save must keep reporting itself even though the read
            // below (and the path it persists) succeeds.
            discover(dialect, { keepError: accepted === false })
          }
        })
        .catch((error: unknown) => {
          store.setState({ saving: false, error: translate('row.saveFailed', { message: messageOf(error) }) })
        })
    }
    persist(false)
  }

  const setConfinedPolicy = (policy: ConfinedPolicy): void => {
    // Optimistic for the same reason as the dialect dropdown: a rejected write
    // is restored by the next form snapshot and surfaced as an error.
    store.setState({ confinedPolicy: policy, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['confinedPolicy'], value: policy }])
  }

  const setMinimalMode = (mode: MinimalMode): void => {
    // Optimistic like the other two dropdowns: the next form snapshot restores
    // the old value if the Host rejects the write.
    store.setState({ minimalMode: mode, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['minimalMode'], value: mode }])
  }

  const setBashPath = (path: string): void => {
    const trimmed = path.trim()
    store.setState({ bashPath: trimmed, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['bashPath'], value: trimmed }])
  }

  /**
   * Persist the explicit `cmd.exe`, or `''` for auto-resolution.
   *
   * Deliberately not validated here: resolution is the Host's job (config →
   * `ComSpec` → `%SystemRoot%\System32\cmd.exe`), and a path that does not exist
   * yet is a legitimate intermediate state while the user is typing. A bad path
   * surfaces as `cmd-not-found` on the next session instead.
   */
  const setCmdPath = (path: string): void => {
    const trimmed = path.trim()
    if (!looksLikeCmd(trimmed)) {
      store.setState({ error: translate('row.cmdPath.invalid'), notice: undefined })
      return
    }
    store.setState({ cmdPath: trimmed, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['cmdPath'], value: trimmed }])
  }

  /**
   * Persist the console code page.
   *
   * Normalized on the way in so the form never receives `NaN`, `0` or a
   * fractional value: `chcp` would fail on those and the generated script has no
   * way to recover.
   */
  const setCmdCodePage = (codePage: number): void => {
    const next = normalizeCodePage(codePage)
    store.setState({ cmdCodePage: next, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['cmdCodePage'], value: next }])
  }

  const setCmdConfinedPolicy = (policy: CmdConfinedPolicy): void => {
    // Optimistic like the other dropdowns; `cmdConfinedPolicy` is a separate
    // field from `confinedPolicy` so switching dialect back and forth never
    // overwrites the bash choice.
    store.setState({ cmdConfinedPolicy: policy, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['cmdConfinedPolicy'], value: policy }])
  }

  const discover = (dialectArg?: Dialect, options?: { keepError?: boolean }): void => {
    const dialect: Dialect = dialectArg ?? store.getState().dialect
    if (dialect === 'pwsh') return
    const isCmd = dialect === 'cmd'
    const keepError = options?.keepError === true
    const current = isCmd ? store.getState().cmdPath : store.getState().bashPath
    store.setState({ discovering: true, ...(keepError ? {} : { error: undefined }), notice: undefined })
    const run = (allowRetry: boolean): void => {
      void fetchCandidates(dialect, current)
        .then((view) => {
          const usable: string[] = []
          for (const candidate of view.candidates) {
            if (!candidate.valid) continue
            if (usable.some((path) => samePath(path, candidate.path))) continue
            usable.push(candidate.path)
          }
          if (usable.length === 0) {
            store.setState({
              discovering: false,
              ...(isCmd ? { cmdScanned: [] as string[] } : { scanned: [] as string[] }),
              notice: translate('row.foundNone'),
            })
            return
          }
          // Keep the user's current choice when the sweep still considers it
          // usable; only a missing/invalid path is replaced.
          const trimmed = current.trim()
          const picked = trimmed.length > 0 && usable.some((path) => samePath(path, trimmed)) ? trimmed : usable[0]!
          if (isCmd) {
            store.setState({ discovering: false, cmdScanned: usable, cmdPath: picked, notice: undefined })
            write([{ op: 'set', path: ['cmdPath'], value: picked }], keepError)
            return
          }
          store.setState({ discovering: false, scanned: usable, bashPath: picked, notice: undefined })
          write(
            [
              { op: 'set', path: ['bashPath'], value: picked },
              { op: 'set', path: ['bashCandidates'], value: usable },
            ],
            keepError,
          )
        })
        .catch((error: unknown) => {
          // The route can be missing for an instant while the Host re-applies
          // the entry after a write; retry once before blaming the Host.
          if (allowRetry) {
            setTimeout(() => {
              run(false)
            }, DISCOVERY_RETRY_MS)
            return
          }
          store.setState({ discovering: false, error: requestError(translate, error) })
        })
    }
    run(true)
  }

  /** Read `/state` and follow the form; returns the teardown. */
  const start = (): (() => void) => {
    let active = true
    const disposers: (() => void)[] = []

    if (scope !== undefined) {
      syncSettings()
      disposers.push(scope.subscribe(syncSettings))
    }

    void fetchState()
      .then((state) => {
        if (!active) return
        store.setState({
          platform: state.platform,
          settingsAvailable: state.settingsAvailable,
          supported: state.capability.supported,
          ...(state.capability.reason === undefined ? {} : { unsupportedReason: state.capability.reason }),
          // The form's value wins whenever it has arrived; `/state` is the
          // fallback for the brief window before the describe mirror loads.
          // `/state` carries only the cmd path (code page and policy have no
          // wire field), so the other two keep their defaults until the form
          // delivers them — which is the same value the schema defaults to.
          ...(settingsReady
            ? {}
            : {
                dialect: normalizeDialect(state.dialect),
                bashPath: state.bashPath ?? '',
                cmdPath: looksLikeCmd(state.cmdPath ?? '') ? (state.cmdPath ?? '') : '',
                minimalMode: normalizeMinimalMode(state.minimalMode),
              }),
          // The variant lifecycle is Host-owned: never cached across a mount.
          // A Host that predates the field has none, so keep the empty state
          // rather than letting the row render against undefined.
          ...(state.variant === undefined ? {} : { variant: state.variant }),
          status: state.platform === 'win32' ? 'ready' : 'hidden',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        // Without `/state` the platform is unknown. Assuming win32 keeps the row
        // visible (with an error) instead of silently hiding a broken install;
        // the component still hides itself when it learns the platform.
        store.setState({
          status: 'ready',
          supported: false,
          error: requestError(translate, error),
        })
      })

    return () => {
      active = false
      for (const dispose of disposers) dispose()
    }
  }

  return {
    store,
    start,
    setDialect,
    setConfinedPolicy,
    setMinimalMode,
    setBashPath,
    setCmdPath,
    setCmdCodePage,
    setCmdConfinedPolicy,
    discover,
  }
}
