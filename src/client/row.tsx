import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Input,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'

import {
  createRowController,
  knownPaths,
  normalizeDialect,
  type Dialect,
  type MinimalMode,
  type RowController,
  type RowState,
} from './store.ts'
import type { CmdConfinedPolicy } from '../cmd/types.ts'
import type { ConfinedPolicy } from '../confined.ts'
import type { RowProps } from './types.ts'

/**
 * The 设置 → 通用 → 终端工具 row.
 *
 * Shape, copied from the two official row types that surround it in the General
 * section:
 *
 * ```
 * 终端工具                                        [PowerShell（pwsh） ▾]
 * 模型执行命令时使用的终端；改动只影响新会话。
 * Git Bash 路径                                   [C:/…/bash.exe     ▾] [自动发现]
 * ```
 *
 * Every control is an official `@deepseek-ai/dsh-client-ui-primitives`
 * component, so buttons, the dropdown trigger, the menu card and its rows are
 * pixel-identical to the neighbouring settings: `Menu` for both enumerated
 * choices (the section renders *every* enumerated preference as a dropdown),
 * `Input` for a hand-typed path, `Button` for 自动发现. This file only owns
 * layout, copy and the two-column row skeleton.
 *
 * Deliberate choices:
 *
 * - **Nothing renders until the platform is known** (`status !== 'ready'`
 *   returns null), otherwise the row flashes in and then disappears on Linux.
 * - **No candidate list is rendered.** The path control *is* the picker: it
 *   becomes a dropdown once the sweep found more than one bash.
 * - **The input is uncontrolled between commits** so a settings round trip
 *   cannot eat keystrokes.
 * - **Fields follow the dialect, and nothing else.** `pwsh` shows the dialect
 *   choice only; `bash` shows the bash path, the sandbox policy and the minimal
 *   mode; `cmd` shows the `cmd.exe` path, the code page and its own sandbox
 *   policy. A field is never rendered "greyed out" for a dialect that cannot
 *   honour it — it is simply absent, so the row cannot suggest a setting that
 *   does nothing.
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
  const pathItems: readonly MenuEntry[] = paths.map((path) => ({ id: path, label: path }))
  const confinedItems: readonly MenuEntry[] = [
    { id: 'unconfined', label: t('row.confined.unconfined') },
    { id: 'escalate', label: t('row.confined.escalate') },
    { id: 'fail', label: t('row.confined.fail') },
  ]
  // No `fail` member, unlike the bash policy: `cmd.exe` starts under a
  // restricted Windows token, so "refuse to run" would be a setting that can
  // never fire.
  const cmdConfinedItems: readonly MenuEntry[] = [
    { id: 'escalate', label: t('row.cmdConfinedPolicy.escalate') },
    { id: 'unconfined', label: t('row.cmdConfinedPolicy.unconfined') },
  ]
  const minimalItems: readonly MenuEntry[] = [
    { id: 'leave', label: t('row.minimal.leave') },
    { id: 'oneshot', label: t('row.minimal.oneshot') },
    { id: 'variant', label: t('row.minimal.variant') },
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
          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.path.label')}</div>
              {bashPath === '' ? <div className="tterm-hint">{t('row.path.missing')}</div> : null}
            </div>

            <div className="tterm-path-control">
              {paths.length > 1 ? (
                <Selector
                  className="tterm-path-selector"
                  label={t('row.path.label')}
                  value={bashPath === '' ? t('row.path.none') : bashPath}
                  items={pathItems}
                  selectedId={bashPath}
                  disabled={!controlsEnabled}
                  onSelect={(path) => {
                    if (path !== bashPath) controller.setBashPath(path)
                  }}
                />
              ) : (
                <Input
                  id={PATH_CONTROL_ID}
                  className="tterm-path-input"
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label={t('row.path.label')}
                  placeholder={t('row.path.placeholder')}
                  value={draft}
                  disabled={!controlsEnabled}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitPath}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitPath()
                    }
                  }}
                />
              )}
              <Button variant="outline" size="sm" disabled={!controlsEnabled} onClick={() => controller.discover()}>
                {state.discovering ? t('row.discovering') : t('row.discover')}
              </Button>
            </div>
          </div>

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.confined.label')}</div>
              <div className="tterm-description">{t('row.confined.description')}</div>
              {state.confinedPolicy === 'unconfined' ? (
                <div className="tterm-hint" role="note">
                  {t('row.confined.unconfinedNotice')}
                </div>
              ) : null}
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.confined.label')}
              value={t(`row.confined.${state.confinedPolicy}`)}
              items={confinedItems}
              selectedId={state.confinedPolicy}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: ConfinedPolicy = id === 'escalate' ? 'escalate' : id === 'fail' ? 'fail' : 'unconfined'
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
        </>
      ) : null}

      {dialect === 'cmd' ? (
        <>
          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.cmdPath.label')}</div>
              <div className="tterm-description">{t('row.cmdPath.description')}</div>
              {/* The dialect's limits, stated once, where the user first meets it. */}
              <div className="tterm-hint" role="note">
                {t('row.cmd.limits')}
              </div>
            </div>

            <div className="tterm-path-control">
              <Input
                id={CMD_PATH_CONTROL_ID}
                className="tterm-path-input"
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label={t('row.cmdPath.label')}
                placeholder={t('row.cmdPath.placeholder')}
                value={cmdDraft}
                disabled={!controlsEnabled}
                onChange={(event) => setCmdDraft(event.target.value)}
                onBlur={commitCmdPath}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitCmdPath()
                  }
                }}
              />
            </div>
          </div>

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

          <div className="tterm-row">
            <div className="tterm-text">
              <div className="tterm-field-label">{t('row.cmdConfinedPolicy.label')}</div>
              <div className="tterm-description">{t('row.cmdConfinedPolicy.description')}</div>
              {state.cmdConfinedPolicy === 'unconfined' ? (
                <div className="tterm-hint" role="note">
                  {t('row.cmdConfinedPolicy.unconfinedNotice')}
                </div>
              ) : null}
            </div>

            <Selector
              className="tterm-dialect"
              label={t('row.cmdConfinedPolicy.label')}
              value={t(`row.cmdConfinedPolicy.${state.cmdConfinedPolicy}`)}
              items={cmdConfinedItems}
              selectedId={state.cmdConfinedPolicy}
              disabled={!controlsEnabled}
              onSelect={(id) => {
                const next: CmdConfinedPolicy = id === 'unconfined' ? 'unconfined' : 'escalate'
                if (next !== state.cmdConfinedPolicy) controller.setCmdConfinedPolicy(next)
              }}
            />
          </div>
        </>
      ) : null}
    </div>
  )
}
