import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  IconChevronDownOutlineRegular,
  Input,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  createRowController,
  knownCmdPaths,
  knownPaths,
  normalizeDialect,
  normalizeSidebarBash,
  type Dialect,
  type MinimalMode,
  type RowController,
  type RowState,
} from './store.ts'
import type { CmdConfinedPolicy, ConfinedPolicy, SidebarBash } from '../shared/protocol.ts'
import type { RowProps } from './types.ts'

/**
 * The 设置 → 通用 → 终端 Shell row.
 *
 * Shape, copied from the two official row types that surround it in the General
 * section: one title + one sentence at the top, then one row per setting.
 *
 * ```
 * 终端 Shell                                            [powershell ▾]
 * 选择智能体工具调用终端使用的 shell。改动后仅在新会话生效。
 * Git Bash 路径                              [C:/…/bash.exe      ▾]
 * 沙箱策略                                              [绕过沙箱 ▾]
 * 选择沙箱将命令降为低完整性时的行为模式
 * ```
 *
 * Every control is an official `@deepseek-ai/dsh-client-ui-primitives`
 * component, so the dropdown trigger, the menu card and its rows are
 * pixel-identical to the neighbouring settings: `Menu` for every enumerated
 * preference (the section renders *every* enumerated preference as a dropdown),
 * `Input` for a hand-typed path. This file only owns layout, copy and the
 * two-column row skeleton.
 *
 * Deliberate choices:
 *
 * - **Nothing renders until the platform is known** (`status !== 'ready'`
 *   returns null), otherwise the row flashes in and then disappears on Linux.
 * - **No candidate list is rendered and no "detect" button exists.** Picking a
 *   terminal kind is what triggers discovery; the path control *is* the picker —
 *   it becomes a dropdown once more than one executable is known. Git Bash and
 *   cmd share the same `PathRow`, so the two dialects behave identically.
 * - **The input is uncontrolled between commits** so a settings round trip
 *   cannot eat keystrokes.
 * - **Fields follow the dialect, and nothing else.** `pwsh` shows the dialect
 *   choice only; `bash` shows the bash path, the sandbox policy and the minimal
 *   mode; `cmd` shows the `cmd.exe` path, the console code page and the *same*
 *   sandbox policy row the bash dialect uses (label, copy and the two answers are
 *   shared, so the two dialects cannot drift apart). A field is never rendered
 *   "greyed out" for a dialect that cannot honour it — it is simply absent, so the
 *   row cannot suggest a setting that does nothing.
 */

/** Id of the path control, used by the visible label. */
const PATH_CONTROL_ID = 'dsh-terminal-shell-path'

/** Id of the `cmd.exe` override field. */
const CMD_PATH_CONTROL_ID = 'dsh-terminal-shell-cmd-path'

/** Id of the console code page field. */
const CODE_PAGE_CONTROL_ID = 'dsh-terminal-shell-cmd-codepage'

/** Follow one store field. */
function useStoreState(controller: RowController): RowState {
  return useSyncExternalStore(controller.store.subscribe, controller.store.getState)
}

/**
 * One official dropdown: a `PreferenceRow`-style trigger plus a `Menu` card.
 *
 * @param props.value - text shown in the trigger.
 * @param props.items - the menu rows.
 * @param props.selectedId - row drawn as selected.
 * @param props.label - accessible name of the trigger.
 * @param props.disabled - whether the trigger refuses input.
 * @param props.className - layout class on the menu's anchor wrapper.
 * @param props.onSelect - called with the id of the chosen row.
 */
function Selector(props: {
  readonly value: string
  readonly items: readonly MenuEntry[]
  readonly selectedId: string
  readonly label: string
  readonly disabled: boolean
  readonly className: string
  readonly onSelect: (id: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => setOpen(false)}
      items={props.items}
      selectedId={props.selectedId}
      onSelect={(id) => {
        setOpen(false)
        props.onSelect(id)
      }}
      align="end"
      portal
      className={props.className}
      anchor={
        <button
          type="button"
          className="tterm-selector"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={props.label}
          disabled={props.disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="tterm-selector-value">{props.value}</span>
          <IconChevronDownOutlineRegular className="tterm-chevron" />
        </button>
      }
    />
  )
}

/**
 * One path row, shared by the Git Bash and cmd dialects.
 *
 * Both dialects answer the same question ("which executable should a session
 * run?"); the only difference is the copy and how discovery is spelled on the
 * Host. Rendering them through one component is what keeps their pickers,
 * spacing and empty/error states identical.
 *
 * The control is a `Selector` when more than one executable is known and an
 * `Input` otherwise, exactly like the enum preferences above it. There is no
 * "detect" button: discovery is triggered by choosing the terminal kind.
 */
function PathRow(props: {
  readonly label: string
  readonly description?: string | undefined
  readonly hint?: string | undefined
  readonly notice?: string | undefined
  readonly inputId: string
  readonly placeholder: string
  readonly noneLabel: string
  readonly paths: readonly string[]
  readonly selected: string
  readonly draft: string
  readonly disabled: boolean
  readonly onDraftChange: (value: string) => void
  readonly onCommit: () => void
  readonly onPick: (path: string) => void
}): ReactElement {
  const items: readonly MenuEntry[] = props.paths.map((path) => ({ id: path, label: path }))
  const trimmed = props.selected.trim()
  return (
    <div className="tterm-row tterm-row--path">
      <div className="tterm-text">
        <label className="tterm-field-label" htmlFor={props.paths.length > 1 ? undefined : props.inputId}>
          {props.label}
        </label>
        {props.description === undefined ? null : (
          <div className="tterm-description">{props.description}</div>
        )}
        {props.hint === undefined ? null : <div className="tterm-hint">{props.hint}</div>}
        {props.notice === undefined ? null : (
          <div className="tterm-hint" role="status">
            {props.notice}
          </div>
        )}
      </div>

      <div className="tterm-path-control">
        {props.paths.length > 1 ? (
          <Selector
            className="tterm-path-selector"
            label={props.label}
            value={trimmed === '' ? props.noneLabel : props.selected}
            items={items}
            selectedId={props.selected}
            disabled={props.disabled}
            onSelect={(path) => {
              if (path !== props.selected) props.onPick(path)
            }}
          />
        ) : (
          <Input
            id={props.inputId}
            className="tterm-path-input"
            aria-label={props.label}
            placeholder={props.placeholder}
            value={props.draft}
            disabled={props.disabled}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onBlur={props.onCommit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                props.onCommit()
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Parse a hand-typed code page.
 *
 * Strict on purpose: `chcp` accepts a handful of magic values (`437`, `65001`,
 * `936`, …) and nothing else, and the batch file bakes the number in verbatim.
 * `Number.parseInt` would happily turn `65001abc` into `65001`, which silently
 * saves a value the user did not type, so the shape is checked first.
 *
 * @returns the code page, or `undefined` when the text is not a positive integer.
 */
function parseCodePage(text: string): number | undefined {
  const raw = text.trim()
  if (!/^\d+$/.test(raw)) return undefined
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

export function TerminalToolRow({ t, form }: RowProps): ReactElement | null {
  // One controller per mounted row: `useState` keeps it stable across renders.
  const [controller] = useState(() => createRowController(form, t))
  const state = useStoreState(controller)

  // The drafts live in component state and are pushed on blur or Enter; the
  // effects below re-seed them whenever the Host value changes.
  const [draft, setDraft] = useState(state.bashPath)
  const [cmdDraft, setCmdDraft] = useState(state.cmdPath)
  const [codePageDraft, setCodePageDraft] = useState(String(state.cmdCodePage))

  // `start()` is self-contained (one `/state` read plus a form subscription) and
  // its return value tears both down, so the effect can simply start and stop it
  // per mount. Guarding it with a ref would break the strict-mode double invoke:
  // the second mount would see the guard set and never resubscribe.
  useEffect(() => controller.start(), [controller])

  useEffect(() => {
    setDraft(state.bashPath)
  }, [state.bashPath])

  useEffect(() => {
    setCmdDraft(state.cmdPath)
  }, [state.cmdPath])

  useEffect(() => {
    setCodePageDraft(String(state.cmdCodePage))
  }, [state.cmdCodePage])

  // Nothing to show until we know the platform; a Linux/macOS Host hides the
  // row entirely (the plugin's replacement is Windows-only).
  if (state.status !== 'ready') return null

  const controlsEnabled = state.writable && state.supported && !state.saving && !state.discovering
  const dialect: Dialect = state.dialect
  const bashPath = state.bashPath.trim()
  const cmdPath = state.cmdPath.trim()
  const paths = knownPaths(state)
  const cmdPaths = knownCmdPaths(state)

  /** Commit the typed bash path, if it changed. */
  const commitPath = (): void => {
    const next = draft.trim()
    if (next === bashPath) return
    controller.setBashPath(next)
  }

  /** Commit the typed `cmd.exe` path, if it changed. Empty means auto-resolve. */
  const commitCmdPath = (): void => {
    const next = cmdDraft.trim()
    if (next === cmdPath) return
    controller.setCmdPath(next)
  }

  /**
   * Commit the typed code page.
   *
   * Unparseable text is not persisted and the field snaps back to the stored
   * value: writing `NaN` would reach `chcp` and break every command in the
   * session, which is far worse than the field refusing a typo.
   */
  const commitCodePage = (): void => {
    const parsed = parseCodePage(codePageDraft)
    if (parsed === undefined) {
      setCodePageDraft(String(state.cmdCodePage))
      return
    }
    if (parsed === state.cmdCodePage) return
    controller.setCmdCodePage(parsed)
  }

  const dialectItems: readonly MenuEntry[] = [
    { id: 'pwsh', label: t('row.dialect.pwsh') },
    { id: 'bash', label: t('row.dialect.bash') },
    { id: 'cmd', label: t('row.dialect.cmd') },
  ]
  // Both dialects share one policy row: the same two answers apply, so label,
  // copy and selector are identical. A profile that still stores the retired
  // `fail` value keeps rendering its label, but the menu no longer offers it.
  const confinedItems: readonly MenuEntry[] = [
    { id: 'unconfined', label: t('row.confined.unconfined') },
    { id: 'escalate', label: t('row.confined.escalate') },
  ]
  const minimalItems: readonly MenuEntry[] = [
    { id: 'leave', label: t('row.minimal.leave') },
    { id: 'oneshot', label: t('row.minimal.oneshot') },
    { id: 'variant', label: t('row.minimal.variant') },
  ]
  // The cmd dialect has no persistent backend, so "add a new preset" (which is
  // a persistent bash variant) is not offered here: only keeping the official
  // pwsh terminal and replacing it with a one-shot cmd mean anything.
  const cmdMinimalItems: readonly MenuEntry[] = [
    { id: 'leave', label: t('row.minimal.leave') },
    { id: 'oneshot', label: t('row.minimal.oneshotCmd') },
  ]
  // Sidebar New-Terminal bash choice. Ends the bash block: it is the last, most
  // "environment" flavoured decision, and it only affects the interactive
  // sidebar terminal (not the tool the agent uses).
  const sidebarBashItems: readonly MenuEntry[] = [
    { id: 'system', label: t('row.sidebarBash.system') },
    { id: 'gitbash', label: t('row.sidebarBash.gitbash') },
  ]

  return (
    <div className="tterm-group" data-dsh-terminal-shell="row">
      <div className="tterm-row">
        <div className="tterm-text">
          <div className="tterm-title">{t('row.title')}</div>
          <div className="tterm-description">{t('row.description')}</div>
          {state.supported ? null : (
            <div className="tterm-hint">{t('row.notSupported', { reason: state.unsupportedReason ?? '' })}</div>
          )}
          {state.settingsAvailable ? null : <div className="tterm-hint">{t('row.unavailable')}</div>}
          {state.notice === undefined ? null : (
            <div className="tterm-hint" role="status">
              {state.notice}
            </div>
          )}
          {state.error === undefined ? null : (
            <div className="tterm-error" role="alert">
              {state.error}
            </div>
          )}
        </div>

        <Selector
          className="tterm-dialect"
          label={t('row.dialect.label')}
          value={t(`row.dialect.${dialect}`)}
          items={dialectItems}
          selectedId={dialect}
          disabled={!controlsEnabled}
          onSelect={(id) => {
            const next = normalizeDialect(id)
            if (next !== dialect) controller.setDialect(next)
          }}
        />
      </div>

      {dialect === 'bash' ? (
        <>
          <PathRow
            label={t('row.path.label')}
            hint={
              state.discovering
                ? t('row.discovering')
                : bashPath === ''
                  ? t('row.path.missing')
                  : undefined
            }
            inputId={PATH_CONTROL_ID}
            placeholder={t('row.path.placeholder')}
            noneLabel={t('row.path.none')}
            paths={paths}
            selected={bashPath}
            draft={draft}
            disabled={!controlsEnabled}
            onDraftChange={setDraft}
            onCommit={commitPath}
            onPick={controller.setBashPath}
          />

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.confined.label')}</div>
              <div className="tterm-description">{t('row.confined.description', { shell: 'bash' })}</div>
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.confined.label')}
              value={t(`row.confined.${state.confinedPolicy}`)}
              items={confinedItems}
              selectedId={state.confinedPolicy}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: ConfinedPolicy = id === 'escalate' ? 'escalate' : 'unconfined'
                if (next !== state.confinedPolicy) controller.setConfinedPolicy(next)
              }}
            />
          </div>

          {state.supported ? (
            <div className="tterm-row">
              <div className="tterm-text">
                <div className="tterm-field-label">{t('row.minimal.label')}</div>
                <div className="tterm-description">{t('row.minimal.description')}</div>
                {state.variant?.status === 'registered' ? (
                  <div className="tterm-hint" role="note">
                    {t('row.minimal.variantReady', { id: state.variant.id })}
                  </div>
                ) : state.variant?.status === 'retained' ? (
                  <div className="tterm-hint" role="note">
                    {t('row.minimal.variantRetained', {
                      id: state.variant.id,
                      count: String(state.variant.refs),
                    })}
                  </div>
                ) : state.variant?.status === 'failed' ? (
                  <div className="tterm-error" role="alert">
                    {t('row.minimal.variantFailed', { reason: state.variant.reason ?? '' })}
                  </div>
                ) : null}
              </div>

              <Selector
                className="tterm-dialect"
                label={t('row.minimal.label')}
                value={t(`row.minimal.${state.minimalMode}`)}
                items={minimalItems}
                selectedId={state.minimalMode}
                disabled={!controlsEnabled}
                onSelect={(id) => {
                  const next: MinimalMode = id === 'leave' ? 'leave' : id === 'variant' ? 'variant' : 'oneshot'
                  if (next !== state.minimalMode) controller.setMinimalMode(next)
                }}
              />
            </div>
          ) : null}

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.sidebarBash.label')}</div>
              <div className="tterm-description">{t('row.sidebarBash.description')}</div>
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.sidebarBash.label')}
              value={t(`row.sidebarBash.${state.sidebarBash}`)}
              items={sidebarBashItems}
              selectedId={state.sidebarBash}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: SidebarBash = normalizeSidebarBash(id)
                if (next !== state.sidebarBash) controller.setSidebarBash(next)
              }}
            />
          </div>
        </>
      ) : null}

      {dialect === 'cmd' ? (
        <>
          <PathRow
            label={t('row.cmdPath.label')}
            hint={state.discovering ? t('row.discovering') : undefined}
            inputId={CMD_PATH_CONTROL_ID}
            placeholder={t('row.cmdPath.placeholder')}
            noneLabel={t('row.path.none')}
            paths={cmdPaths}
            selected={cmdPath}
            draft={cmdDraft}
            disabled={!controlsEnabled}
            onDraftChange={setCmdDraft}
            onCommit={commitCmdPath}
            onPick={controller.setCmdPath}
          />

          {/* Same order as the bash dialect: executable first, then the sandbox
              policy, then whatever is specific to the dialect. */}
          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.confined.label')}</div>
              <div className="tterm-description">{t('row.confined.description', { shell: 'cmd' })}</div>
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.confined.label')}
              value={t(`row.confined.${state.cmdConfinedPolicy}`)}
              items={confinedItems}
              selectedId={state.cmdConfinedPolicy}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: CmdConfinedPolicy = id === 'unconfined' ? 'unconfined' : 'escalate'
                if (next !== state.cmdConfinedPolicy) controller.setCmdConfinedPolicy(next)
              }}
            />
          </div>

          {state.supported ? (
            <div className="tterm-row">
              <div className="tterm-text">
                <div className="tterm-field-label">{t('row.minimal.label')}</div>
                <div className="tterm-description">{t('row.minimal.cmdDescription')}</div>
                {state.variant?.status === 'registered' ? (
                  <div className="tterm-hint" role="note">
                    {t('row.minimal.variantReady', { id: state.variant.id })}
                  </div>
                ) : state.variant?.status === 'failed' ? (
                  <div className="tterm-error" role="alert">
                    {t('row.minimal.variantFailed', { reason: state.variant.reason ?? '' })}
                  </div>
                ) : null}
              </div>

              <Selector
                className="tterm-dialect"
                label={t('row.minimal.label')}
                value={state.minimalMode === 'oneshot' ? t('row.minimal.oneshotCmd') : t(`row.minimal.${state.minimalMode}`)}
                items={cmdMinimalItems}
                selectedId={state.minimalMode}
                disabled={!controlsEnabled}
                onSelect={(id) => {
                  const next: MinimalMode = id === 'leave' ? 'leave' : 'oneshot'
                  if (next !== state.minimalMode) controller.setMinimalMode(next)
                }}
              />
            </div>
          ) : null}

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.cmdCodePage.label')}</div>
              <div className="tterm-description">{t('row.cmdCodePage.description')}</div>
            </div>

            <Input
              id={CODE_PAGE_CONTROL_ID}
              className="tterm-code-page-input"
              type="text"
              inputMode="numeric"
              spellCheck={false}
              autoComplete="off"
              aria-label={t('row.cmdCodePage.label')}
              placeholder="65001"
              value={codePageDraft}
              disabled={!controlsEnabled}
              onChange={(event) => setCodePageDraft(event.target.value)}
              onBlur={commitCodePage}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitCodePage()
                }
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
