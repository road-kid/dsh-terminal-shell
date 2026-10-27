/**
 * Render test: mount the real client bundle in a DOM and drive the row.
 *
 * `rowselftest.mjs` covers the controller's decisions and `clientsmoke.mjs`
 * covers the registration contract, but neither renders JSX. This script loads
 * `lib/client.js` exactly as the page does (`window.__ModuleLoader__.load`),
 * calls `apply()` on a stub context, then mounts the registered component with
 * React 18 in jsdom and drives it through the official controls.
 *
 * It catches the class of bug the other two cannot: a hook order error, a
 * missing `useEffect`, a control that never appears, an `onChange` wired to the
 * wrong handler.
 *
 * The official atoms come from `scripts/primitives-double.mjs`: the shipped
 * bundle requires them from the Web shell's module table, which a Node process
 * does not have.
 *
 * Run with `npm run rendertest`. Needs `react`, `react-dom` and `jsdom`, which
 * are devDependencies only: the shipped bundle keeps react external.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { JSDOM } from 'jsdom'

import { primitivesStub } from './primitives-double.mjs'

const require = createRequire(import.meta.url)

/** The module the shell seeds and the bundle requires instead of bundling. */
const PRIMITIVES = '@deepseek-ai/dsh-client-ui-primitives'

let passed = 0
let failed = 0

async function test(name, body) {
  try {
    await body()
    passed += 1
    process.stdout.write(`ok   ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

// --- page environment ------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1/',
  pretendToBeVisual: true,
})

// React reads these off the global object, so they have to exist *before*
// `react-dom/client` is imported.
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.KeyboardEvent = dom.window.KeyboardEvent
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = require('react')
const { createRoot } = require('react-dom/client')
const act = React.act

const primitives = primitivesStub(React)

/** Let effects and microtasks settle. */
const settle = () => act(async () => {})

// --- load the bundle the way the page loader does --------------------------

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * Execute the bundle once and return its exports.
 *
 * Each call gets a fresh module instance, like a page reload: `apply()` guards
 * against seating the row twice with a module-level flag, so reusing one
 * instance would make every test after the first a no-op.
 */
function loadBundle() {
  let captured
  const windowStub = {
    __ModuleLoader__: {
      load(entry) {
        captured = entry
      },
    },
  }
  const required = []
  const resolve = (specifier) => {
    required.push(specifier)
    if (specifier === PRIMITIVES) return primitives
    return require(specifier)
  }
  // The bundle is a classic script: run it with `window` bound to our stub and a
  // `require` that resolves react from node_modules (the page seeds the same two
  // modules).
  new Function('window', 'require', source)(windowStub, resolve)
  assert.ok(captured, 'the bundle called __ModuleLoader__.load')
  return { id: captured.id, exports: captured.factory(resolve), required }
}

// --- stub context ----------------------------------------------------------

/** A settings form stub with a fixed snapshot and recorded mutations. */
function formStub(initial) {
  const snapshot = { status: 'ready', value: initial, revision: 1, writable: true }
  const mutations = []
  return {
    mutations,
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async mutate(ops) {
      mutations.push(ops)
      return true
    },
  }
}

/** Wire `apply()` to a stub context and return the registered row component. */
function mountRow({ form, state, discover }) {
  const calls = { registered: [], locale: [] }
  const ctx = {
    effect(callback) {
      callback()
    },
    get(name) {
      if (name === 'slots') {
        return {
          inject(_key, callback) {
            callback()
          },
          register(options, component) {
            calls.registered.push({ options, component })
            return () => {}
          },
        }
      }
      if (name === 'locale') {
        return {
          register(namespace, dictionaries) {
            calls.locale.push({ namespace, dictionaries })
            return () => {}
          },
          bind(namespace) {
            const dictionaries = calls.locale[0]?.dictionaries ?? { zh: {}, en: {} }
            return (key, params) => {
              const template = dictionaries.zh[key] ?? key
              return params === undefined
                ? template
                : template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? ''))
            }
          },
        }
      }
      if (name === 'configForms') return { get: () => form }
      return undefined
    },
    inject(_names, callback) {
      callback(ctx)
    },
  }

  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'http://127.0.0.1').pathname
    if (path.endsWith('/discover')) return new Response(JSON.stringify(discover), { status: 200 })
    return new Response(JSON.stringify(state), { status: 200 })
  }

  const loaded = loadBundle()
  loaded.exports.apply(ctx)
  assert.equal(calls.registered.length, 1, 'exactly one row registered')
  const { options, component } = calls.registered[0]
  // The slot host builds the component's props from the registration's
  // `inject()` face — that is where the bound translate and the form come from.
  return { component, props: options.inject(), required: loaded.required }
}

const READY_STATE = {
  platform: 'win32',
  settingsAvailable: true,
  dialect: 'pwsh',
  bashPath: '',
  bashCandidates: [],
  capability: { supported: true },
}

/** Mount a component into a fresh root and return a query helper. */
async function render(Component, props) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(React.createElement(Component, props))
  })
  await settle()
  return {
    host,
    text: () => host.textContent ?? '',
    /** A button by its visible label. */
    button: (label) => [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(label)),
    /** The dropdown trigger carrying an accessible name. */
    trigger: (name) => host.querySelector(`button[aria-haspopup="menu"][aria-label="${name}"]`),
    /** Every dropdown trigger in the row. */
    triggers: () => [...host.querySelectorAll('button[aria-haspopup="menu"]')],
    /**
     * The open menu card, if any. The real `Menu` portals it to `document.body`,
     * so it is deliberately *not* looked up inside the row's host.
     */
    menu: () => document.querySelector('[role="menu"]'),
    /** The rows of the open menu. */
    menuItems: () => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')],
    root,
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
}

/** Click one element inside `act`. */
async function click(node) {
  assert.ok(node, 'the element to click exists')
  await act(async () => {
    node.click()
  })
  await settle()
}

// --- tests -----------------------------------------------------------------

await test('the stylesheet is claimed while the module materializes', async () => {
  for (const node of [...document.head.querySelectorAll('style[data-plugin]')]) node.remove()
  loadBundle()
  const sheet = document.head.querySelector('style[data-plugin="dsh-terminal-shell"]')
  assert.ok(sheet, 'a sheet is injected as the module materializes')
  // `data-plugin` is what the loader removes on disable; `data-plugin-css` is
  // this module's own marker for reusing the tag across reloads.
  assert.equal(sheet.getAttribute('data-plugin-css'), 'dsh-terminal-shell/row.css')
  assert.match(sheet.textContent ?? '', /\.tterm-group\{/)
  // A reload reuses the owned tag instead of stacking a second sheet.
  loadBundle()
  assert.equal(document.head.querySelectorAll('style[data-plugin="dsh-terminal-shell"]').length, 1)
})

await test('the row ships the title, one sentence of description and the dialect dropdown', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.match(text, /终端 Shell/)
    assert.match(text, /选择智能体工具调用终端使用的 shell。改动后仅在新会话生效。/)
    // One control only: the dialect dropdown, showing the current value.
    assert.equal(view.triggers().length, 1, 'exactly one dropdown on the pwsh row')
    assert.equal(view.trigger('终端类型').textContent ?? '', 'powershell')
    // Dialect names are the lowercase program names, not sentences.
    assert.doesNotMatch(text, /PowerShell（pwsh）/)
    // The path row is bash-only.
    assert.doesNotMatch(text, /自动发现/)
    assert.doesNotMatch(text, /Git Bash 路径/)
    assert.deepEqual(form.mutations, [], 'mounting never writes')
  } finally {
    await view.unmount()
  }
})

await test('the dialect menu lists every kind and marks the current one', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.equal(view.menu(), null, 'the menu starts closed')
    await click(view.trigger('终端类型'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['powershell', 'bash', 'cmd'],
    )
    // Selected rows are drawn with a leading check icon; the real primitive has
    // no `aria-selected` attribute to assert on.
    assert.deepEqual(
      view.menuItems().map((item) => item.querySelector('[data-check]') !== null),
      [true, false, false],
    )
    // The card is portaled out of the row, like the real `Menu`.
    assert.equal(view.host.querySelector('[role="menu"]'), null)
  } finally {
    await view.unmount()
  }
})

await test('choosing Git Bash reveals the path row and writes the dialect', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('终端类型'))
    await click(view.menuItems()[1])
    assert.match(view.text(), /Git Bash 路径/)
    // No separate detect button: picking the dialect is what scans.
    assert.equal(view.button('自动发现'), undefined)
    // A missing path explains how it will be found.
    assert.match(view.text(), /选择 Git Bash 后会自动扫描本机/)
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'bash' }]])
    assert.equal(view.menu(), null, 'the menu closes after a choice')
  } finally {
    await view.unmount()
  }
})

await test('the bash row shows the sandbox policy, the pwsh row does not', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.match(text, /沙箱策略/)
    assert.match(text, /选择当 Windows 沙箱将命令降为低完整性，bash 启动受限时的行为模式/)
    // One sentence under the label, one dropdown next to it — no extra notice.
    assert.equal(view.trigger('沙箱策略').textContent ?? '', '绕过沙箱')
    assert.equal(view.host.querySelector('[role="note"]'), null)
    assert.deepEqual(form.mutations, [], 'mounting never writes')
  } finally {
    await view.unmount()
  }

  // The choice only exists for the bash dialect.
  const pwshForm = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const pwshRow = mountRow({ form: pwshForm, state: READY_STATE, discover: { candidates: [] } })
  const pwshView = await render(pwshRow.component, pwshRow.props)
  try {
    assert.equal(pwshView.trigger('沙箱策略'), null, 'no sandbox dropdown on the pwsh row')
    assert.doesNotMatch(pwshView.text(), /沙箱策略/)
    assert.equal(pwshView.host.querySelector('[role="note"]'), null)
  } finally {
    await pwshView.unmount()
  }
})

await test('choosing a sandbox policy writes it', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('沙箱策略'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['绕过沙箱', '申请权限'],
      'the retired "report an error" answer is not offered',
    )
    await click(view.menuItems()[1])
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['confinedPolicy'], value: 'escalate' }]])
    assert.equal(view.trigger('沙箱策略').textContent ?? '', '申请权限')
    assert.equal(view.menu(), null, 'the menu closes after a choice')
    assert.equal(view.host.querySelector('[role="note"]'), null)
  } finally {
    await view.unmount()
  }
})

await test('the minimal-mode row offers the three choices and writes one', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\Git\bin\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.match(view.text(), /极简模式/)
    assert.match(view.text(), /选择「极简模式」预设下 pwsh 持久终端的行为模式，添加新预设使用持久 bash 变体/)
    assert.equal(view.trigger('极简模式').textContent ?? '', '单次 bash')
    await click(view.trigger('极简模式'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['保持 pwsh', '单次 bash', '添加新预设'],
    )
    await click(view.menuItems()[2])
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['minimalMode'], value: 'variant' }]])
    assert.equal(view.trigger('极简模式').textContent ?? '', '添加新预设')
  } finally {
    await view.unmount()
  }
})

await test('the minimal-mode row reports the variant lifecycle', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\Git\bin\bash.exe', bashCandidates: [] })

  const ready = mountRow({
    form,
    state: { ...READY_STATE, minimalMode: 'variant', variant: { status: 'registered', id: 'minimal-gitbash', refs: 0 } },
    discover: { candidates: [] },
  })
  const readyView = await render(ready.component, ready.props)
  try {
    assert.match(readyView.text(), /已在预设列表中添加「minimal-gitbash」/)
  } finally {
    await readyView.unmount()
  }

  // A referenced variant is kept rather than removed, and the row says why.
  const retained = mountRow({
    form,
    state: { ...READY_STATE, minimalMode: 'oneshot', variant: { status: 'retained', id: 'minimal-gitbash', refs: 2 } },
    discover: { candidates: [] },
  })
  const retainedView = await render(retained.component, retained.props)
  try {
    assert.match(retainedView.text(), /仍有 2 个会话在使用「minimal-gitbash」/)
    assert.equal(retainedView.host.querySelector('[role="alert"]'), null)
  } finally {
    await retainedView.unmount()
  }

  // A failed registration is an error, not a hint.
  const failed = mountRow({
    form,
    state: {
      ...READY_STATE,
      minimalMode: 'variant',
      variant: { status: 'failed', id: 'minimal-gitbash', refs: 0, reason: 'isolate realms' },
    },
    discover: { candidates: [] },
  })
  const failedView = await render(failed.component, failed.props)
  try {
    assert.match(failedView.text(), /变体注册失败：isolate realms/)
    assert.ok(failedView.host.querySelector('[role="alert"]'), 'a failed variant is an alert')
  } finally {
    await failedView.unmount()
  }
})

await test('a bash row with at most one known path types it into an Input', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="Git Bash 路径"]')
    assert.ok(input, 'the path is a text field')
    assert.equal(input.value, 'C:\\Git\\bin\\bash.exe')
    assert.equal(view.triggers().length, 3, 'dialect, confined and minimal are menus; the path is an Input')
    assert.doesNotMatch(view.text(), /点「自动发现」扫描本机/)
  } finally {
    await view.unmount()
  }
})

await test('editing the path input and pressing Enter persists it', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="Git Bash 路径"]')
    // React tracks the previous value on the node; go through the native setter
    // so it sees the change (the standard jsdom/React workaround).
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      setter.call(input, 'C:\\Program Files\\Git\\bin\\bash.exe')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await settle()
    assert.deepEqual(form.mutations, [
      [{ op: 'set', path: ['bashPath'], value: 'C:\\Program Files\\Git\\bin\\bash.exe' }],
    ])
  } finally {
    await view.unmount()
  }
})

await test('choosing Git Bash scans, then the path control becomes a dropdown of the hits', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({
    form,
    state: READY_STATE,
    discover: {
      candidates: [
        { path: 'C:\\Git\\bin\\bash.exe', source: 'registry', valid: true },
        { path: 'C:\\MSYS2\\usr\\bin\\bash.exe', source: 'msys2', valid: true },
      ],
    },
  })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('终端类型'))
    await click(view.menuItems()[1])
    // Two hits turn the path control into a dropdown; the dialect and confined
    // ones stay.
    assert.equal(view.triggers().length, 4, 'the path control is now a dropdown too')
    const trigger = view.trigger('Git Bash 路径')
    assert.match(trigger.textContent ?? '', /C:\\Git\\bin\\bash\.exe/)
    // First write: the dialect. Second: the pick and the candidate list, together.
    assert.equal(form.mutations.length, 2)
    assert.deepEqual(form.mutations[0], [{ op: 'set', path: ['dialect'], value: 'bash' }])
    assert.deepEqual(form.mutations[1], [
      { op: 'set', path: ['bashPath'], value: 'C:\\Git\\bin\\bash.exe' },
      {
        op: 'set',
        path: ['bashCandidates'],
        value: ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
      },
    ])

    await click(trigger)
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
    )
    await click(view.menuItems()[1])
    assert.deepEqual(form.mutations.at(-1), [
      { op: 'set', path: ['bashPath'], value: 'C:\\MSYS2\\usr\\bin\\bash.exe' },
    ])
  } finally {
    await view.unmount()
  }
})

await test('choosing Git Bash with no hits explains itself instead of clearing the path', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('终端类型'))
    await click(view.menuItems()[1])
    assert.match(view.text(), /没有找到可用的终端程序/)
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'bash' }]])
  } finally {
    await view.unmount()
  }
})

await test('the row is absent off Windows and mounting it wrote nothing', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: [] })
  const row = mountRow({
    form,
    state: { ...READY_STATE, platform: 'linux', capability: { supported: false, reason: 'only windows' } },
    discover: { candidates: [] },
  })
  const view = await render(row.component, row.props)
  try {
    // The replacement is Windows-only, so the row renders nothing at all rather
    // than showing a permanently broken control — and it did not touch the
    // configuration on the way.
    assert.equal(view.text(), '', 'the row renders nothing off Windows')
    assert.deepEqual(form.mutations, [])
  } finally {
    await view.unmount()
  }
})

await test('a read-only form locks the dropdown and the path field', async () => {
  const form = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [] })
  form.getSnapshot = () => ({
    status: 'ready',
    value: { dialect: 'bash', bashPath: '', bashCandidates: [] },
    revision: 1,
    writable: false,
  })
  const row = mountRow({ form, state: READY_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    assert.equal(view.triggers().length, 3)
    assert.equal(view.trigger('终端类型').disabled, true, 'a non-writable form disables the dropdown')
    assert.equal(view.trigger('沙箱策略').disabled, true, 'and the sandbox-policy one')
    assert.equal(view.host.querySelector('input[aria-label="Git Bash 路径"]').disabled, true)
  } finally {
    await view.unmount()
  }
})

// --- cmd dialect ------------------------------------------------------------

/** The `/state` a Windows Host reports; `cmdPath` defaults to empty. */
const CMD_STATE = { ...READY_STATE, cmdPath: '' }

/** Type into an input the way React sees it, then commit with Enter. */
async function typeInto(input, text) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, text)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await settle()
}

await test('choosing cmd reveals the cmd fields and hides the bash ones', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await click(view.trigger('终端类型'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['powershell', 'bash', 'cmd'],
    )
    await click(view.menuItems()[2])
    const text = view.text()
    assert.match(text, /cmd\.exe 路径/)
    assert.match(text, /留空则自动使用系统 cmd\.exe/)
    assert.match(text, /控制台代码页/)
    // Bash-only fields are gone, not greyed out. The minimal row stays: keeping
    // the official pwsh terminal vs. a one-shot cmd is a real choice for cmd.
    assert.doesNotMatch(text, /Git Bash 路径/)
    assert.match(text, /极简模式/)
    assert.match(text, /选择「极简模式」预设下 pwsh 持久终端的行为模式/)
    assert.ok(
      text.indexOf('极简模式') < text.indexOf('控制台代码页'),
      'the minimal row sits above the code page row',
    )
    assert.equal(view.button('自动发现'), undefined)
    assert.equal(view.triggers().length, 3, 'dialect + sandbox policy + minimal mode')
    assert.equal(view.host.querySelector('input[aria-label="cmd.exe 路径"]').value, '')
    assert.equal(view.host.querySelector('input[aria-label="控制台代码页"]').value, '65001')
    // The sandbox row is the same one the bash dialect renders: same label, same
    // copy, same two answers.
    assert.equal(view.trigger('沙箱策略').textContent, '申请权限')
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'cmd' }]])
    assert.equal(view.menu(), null)
  } finally {
    await view.unmount()
  }
})

await test('the cmd minimal row offers keep-pwsh / one-shot cmd', async () => {
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    // Default is one-shot, and the cmd wording must not say "bash".
    assert.equal(view.trigger('极简模式').textContent, '单次 cmd')
    await click(view.trigger('极简模式'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['保持 pwsh', '单次 cmd'],
      'no persistent-bash variant is offered for cmd',
    )
    await click(view.menuItems()[0])
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['minimalMode'], value: 'leave' }]])
  } finally {
    await view.unmount()
  }
})

await test('the cmd code page commits a number and rejects junk', async () => {
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="控制台代码页"]')
    assert.ok(input, 'the code page field is present')
    assert.equal(input.getAttribute('inputmode'), 'numeric')
    await typeInto(input, '936')
    assert.deepEqual(form.mutations, [[{ op: 'set', path: ['cmdCodePage'], value: 936 }]])
    // Junk is never persisted, and the field snaps back to the last saved value.
    await typeInto(input, '65001abc')
    assert.equal(form.mutations.length, 1, 'junk writes nothing')
    assert.equal(input.value, '936', 'the field rolls back to the last saved value')
  } finally {
    await view.unmount()
  }
})

await test('the cmd path refuses a non-cmd.exe program', async () => {
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="cmd.exe 路径"]')
    await typeInto(input, 'C:\\Program Files\\Git\\bin\\bash.exe')
    // Nothing is written and the row explains why; the text stays so it can be fixed.
    assert.deepEqual(form.mutations, [], 'a bash path is never saved as cmdPath')
    assert.match(view.text(), /不能是 bash 或其它程序/)
    assert.equal(input.value, 'C:\\Program Files\\Git\\bin\\bash.exe')
  } finally {
    await view.unmount()
  }
})

await test('a corrupted cmdPath is never rendered as the selected cmd', async () => {
  // A profile that still holds a bash path must not surface it in the cmd row.
  const form = formStub({
    dialect: 'cmd',
    bashPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
    bashCandidates: [],
    cmdPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
  })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const input = view.host.querySelector('input[aria-label="cmd.exe 路径"]')
    assert.equal(input.value, '', 'the bad stored value is dropped, so the field starts empty')
    assert.doesNotMatch(view.text(), /Git\\bin\\bash\.exe/)
  } finally {
    await view.unmount()
  }
})

await test('the cmd path commits and the sandbox choice writes', async () => {
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    await typeInto(view.host.querySelector('input[aria-label="cmd.exe 路径"]'), 'C:/Windows/System32/cmd.exe')
    assert.deepEqual(form.mutations, [
      [{ op: 'set', path: ['cmdPath'], value: 'C:/Windows/System32/cmd.exe' }],
    ])
    assert.equal(view.host.querySelector('[role="note"]'), null)
    await click(view.trigger('沙箱策略'))
    assert.deepEqual(
      view.menuItems().map((item) => item.textContent),
      ['绕过沙箱', '申请权限'],
      'cmd and bash share one sandbox menu',
    )
    await click(view.menuItems()[0])
    assert.deepEqual(form.mutations[1], [{ op: 'set', path: ['cmdConfinedPolicy'], value: 'unconfined' }])
    assert.equal(view.trigger('沙箱策略').textContent, '绕过沙箱')
  } finally {
    await view.unmount()
  }
})

await test('the pwsh row never shows a cmd field', async () => {
  const form = formStub({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
  const row = mountRow({ form, state: CMD_STATE, discover: { candidates: [] } })
  const view = await render(row.component, row.props)
  try {
    const text = view.text()
    assert.doesNotMatch(text, /cmd\.exe 路径/)
    assert.doesNotMatch(text, /控制台代码页/)
    assert.doesNotMatch(text, /沙箱策略/)
    assert.equal(view.triggers().length, 1)
  } finally {
    await view.unmount()
  }
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
