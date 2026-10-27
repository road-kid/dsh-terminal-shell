/**
 * Row controller self-test.
 *
 * The settings row's logic lives entirely in `src/client/store.ts` — the
 * component only renders its state and calls four methods. Testing the
 * controller (rather than the JSX) covers every behaviour that can actually be
 * wrong: what gets written, when, and what the user is told when it fails.
 *
 * `fetch` is stubbed per test; the controller's only I/O is the two `/api`
 * routes. Run with `npm run rowselftest`.
 */

import assert from 'node:assert/strict'

import { createRowController, createStore, INITIAL_ROW_STATE, knownPaths } from '../src/client/store.ts'

/**
 * Default transport. Choosing a kind now triggers a discovery read, so every
 * test that switches kind would otherwise hit Node's real `fetch` (a relative
 * URL throws) and leave a retry timer running into the next test.
 */
const EMPTY_STATE = {
  platform: 'win32',
  settingsAvailable: true,
  dialect: 'pwsh',
  bashPath: '',
  bashCandidates: [],
  cmdPath: '',
  capability: { supported: true },
}
globalThis.fetch = async (input) => {
  const body = String(input).endsWith('/discover') ? { candidates: [] } : EMPTY_STATE
  return new Response(JSON.stringify(body), { status: 200 })
}

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

/** A form stub that records mutations and reports a writable snapshot. */
function formStub(initial = { dialect: 'pwsh', bashPath: '', bashCandidates: [] }, options = {}) {
  const snapshot = { status: 'ready', value: initial, revision: 1, writable: true }
  const listeners = new Set()
  const mutations = []
  const results = [...(options.results ?? [])]
  const pending = []
  return {
    mutations,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** Push a new snapshot value, as the shared mirror does after a write. */
    publish(patch) {
      Object.assign(snapshot.value, patch)
      for (const listener of [...listeners]) listener()
    },
    /** Resolve a mutation parked with the 'hang' result. */
    release(value = true) {
      for (const resolve of pending.splice(0)) resolve(value)
    },
    async mutate(ops) {
      mutations.push(ops)
      const next = results.shift()
      if (next === 'hang') return new Promise((resolve) => pending.push(resolve))
      if (typeof next === 'boolean') return next
      return true
    },
  }
}

/** Replace `globalThis.fetch` for one test, restoring it afterwards. */
async function withFetch(handler, body) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  try {
    return await body()
  } finally {
    globalThis.fetch = original
  }
}

/** Answer any request with a JSON body and status 200. */
function jsonFetch(payload) {
  return async () => new Response(JSON.stringify(payload), { status: 200 })
}

/** Let queued promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

await test('createStore keeps identity when nothing changed', () => {
  const store = createStore({ a: 1, b: 2 })
  const before = store.getState()
  let notified = 0
  store.subscribe(() => {
    notified += 1
  })
  store.setState({ a: 1 })
  assert.equal(store.getState(), before, 'no new object for a no-op patch')
  assert.equal(notified, 0)
  store.setState({ a: 3 })
  assert.equal(notified, 1)
  assert.equal(store.getState().a, 3)
})

await test('knownPaths dedupes across the current, scanned and saved lists', () => {
  const state = {
    ...INITIAL_ROW_STATE,
    bashPath: 'C:\\Git\\bin\\bash.exe',
    scanned: ['c:/git/bin/BASH.EXE', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
    savedCandidates: ['C:\\Git\\bin\\bash.exe', 'C:\\cygwin64\\bin\\bash.exe'],
  }
  assert.deepEqual(knownPaths(state), [
    'C:\\Git\\bin\\bash.exe',
    'C:\\MSYS2\\usr\\bin\\bash.exe',
    'C:\\cygwin64\\bin\\bash.exe',
  ])
})

await test('start() reads /state and hides the row off Windows', async () => {
  const controller = createRowController(undefined, (key) => key)
  await withFetch(
    jsonFetch({
      platform: 'linux',
      settingsAvailable: true,
      dialect: 'pwsh',
      bashPath: '',
      bashCandidates: [],
      capability: { supported: false, reason: 'only windows' },
    }),
    async () => {
      const stop = controller.start()
      await settle()
      const state = controller.store.getState()
      assert.equal(state.status, 'hidden')
      assert.equal(state.platform, 'linux')
      assert.equal(state.supported, false)
      assert.equal(state.unsupportedReason, 'only windows')
      stop()
    },
  )
})

await test('start() mirrors the form value once it arrives', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\Git\\bin\\bash.exe', bashCandidates: ['C:\\Git'] })
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({
      platform: 'win32',
      settingsAvailable: true,
      dialect: 'pwsh',
      bashPath: '',
      bashCandidates: [],
      capability: { supported: true },
    }),
    async () => {
      const stop = controller.start()
      await settle()
      const state = controller.store.getState()
      assert.equal(state.status, 'ready')
      assert.equal(state.dialect, 'bash', 'the form wins over /state')
      assert.equal(state.bashPath, 'C:\\Git\\bin\\bash.exe')
      assert.deepEqual(state.savedCandidates, ['C:\\Git'])
      assert.equal(state.writable, true)
      stop()
    },
  )
})

await test('setDialect writes one op and updates optimistically', async () => {
  const form = formStub()
  const controller = createRowController(form, (key) => key)
  controller.setDialect('bash')
  assert.equal(controller.store.getState().dialect, 'bash')
  await settle()
  assert.deepEqual(form.mutations, [[{ op: 'set', path: ['dialect'], value: 'bash' }]])
  assert.equal(controller.store.getState().saving, false)
})

await test('start() mirrors the confined policy and falls back to unconfined', async () => {
  const state = {
    platform: 'win32',
    settingsAvailable: true,
    dialect: 'pwsh',
    bashPath: '',
    bashCandidates: [],
    capability: { supported: true },
  }
  const form = formStub({
    dialect: 'bash',
    bashPath: '',
    bashCandidates: [],
    confinedPolicy: 'escalate',
  })
  const controller = createRowController(form, (key) => key)
  await withFetch(jsonFetch(state), async () => {
    const stop = controller.start()
    await settle()
    assert.equal(controller.store.getState().confinedPolicy, 'escalate', 'the form wins')
    stop()
  })

  // An absent or unknown wire value is not an error: it means the default.
  const fallback = formStub({ dialect: 'bash', bashPath: '', bashCandidates: [], confinedPolicy: 'nonsense' })
  const fallbackController = createRowController(fallback, (key) => key)
  await withFetch(jsonFetch(state), async () => {
    const stop = fallbackController.start()
    await settle()
    assert.equal(fallbackController.store.getState().confinedPolicy, 'unconfined')
    stop()
  })
})

await test('setConfinedPolicy writes one op and updates optimistically', async () => {
  const form = formStub()
  const controller = createRowController(form, (key) => key)
  controller.setConfinedPolicy('escalate')
  assert.equal(controller.store.getState().confinedPolicy, 'escalate')
  await settle()
  assert.deepEqual(form.mutations, [[{ op: 'set', path: ['confinedPolicy'], value: 'escalate' }]])
  assert.equal(controller.store.getState().saving, false)
  assert.equal(controller.store.getState().error, undefined)
})

await test('discover() persists the picked path together with the usable list', async () => {
  const form = formStub()
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({
      candidates: [
        { path: 'C:\\Git\\bin\\bash.exe', source: 'registry', valid: true },
        { path: 'c:/git/bin/bash.exe', source: 'path', valid: true },
        { path: 'C:\\MSYS2\\usr\\bin\\bash.exe', source: 'msys2', valid: true },
        { path: 'C:\\Windows\\System32\\bash.exe', source: 'path', valid: false },
      ],
    }),
    async () => {
      controller.discover('bash')
      await settle()
      const state = controller.store.getState()
      assert.equal(state.discovering, false)
      assert.deepEqual(state.scanned, ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'])
      assert.equal(state.bashPath, 'C:\\Git\\bin\\bash.exe')
      assert.equal(state.notice, undefined)
      // One atomic write: a reader never sees the path without its candidate list.
      assert.equal(form.mutations.length, 1)
      assert.deepEqual(form.mutations[0], [
        { op: 'set', path: ['bashPath'], value: 'C:\\Git\\bin\\bash.exe' },
        {
          op: 'set',
          path: ['bashCandidates'],
          value: ['C:\\Git\\bin\\bash.exe', 'C:\\MSYS2\\usr\\bin\\bash.exe'],
        },
      ])
    },
  )
})

await test('discover() keeps a still-valid current path', async () => {
  const form = formStub({ dialect: 'bash', bashPath: 'C:\\MSYS2\\usr\\bin\\bash.exe', bashCandidates: [] })
  const controller = createRowController(form, (key) => key)
  // Mount first: the current path comes from the settings form, so the row has
  // to be started before the user can click "Auto-detect".
  const stop = await withFetch(
    jsonFetch({
      platform: 'win32',
      settingsAvailable: true,
      dialect: 'pwsh',
      bashPath: '',
      bashCandidates: [],
      capability: { supported: true },
    }),
    async () => {
      const dispose = controller.start()
      await settle()
      return dispose
    },
  )
  assert.equal(controller.store.getState().bashPath, 'C:\\MSYS2\\usr\\bin\\bash.exe')
  await withFetch(
    jsonFetch({
      candidates: [
        { path: 'C:\\Git\\bin\\bash.exe', source: 'registry', valid: true },
        { path: 'C:\\MSYS2\\usr\\bin\\bash.exe', source: 'msys2', valid: true },
      ],
    }),
    async () => {
      controller.discover('bash')
      await settle()
      assert.equal(controller.store.getState().bashPath, 'C:\\MSYS2\\usr\\bin\\bash.exe')
      assert.deepEqual(controller.store.getState().scanned, [
        'C:\\Git\\bin\\bash.exe',
        'C:\\MSYS2\\usr\\bin\\bash.exe',
      ])
    },
  )
  stop()
})

await test('discover() reports when nothing was found', async () => {
  const form = formStub()
  const controller = createRowController(form, (key) => key)
  await withFetch(jsonFetch({ candidates: [] }), async () => {
    controller.discover('bash')
    await settle()
    const state = controller.store.getState()
    assert.equal(state.discovering, false)
    assert.equal(state.notice, 'row.foundNone')
    assert.deepEqual(form.mutations, [], 'nothing to persist')
  })
})

await test('discover() surfaces a transport failure as a translated error', async () => {
  const form = formStub()
  const calls = []
  const controller = createRowController(form, (key, params) => {
    calls.push([key, params])
    return key
  })
  let attempts = 0
  await withFetch(
    async () => {
      attempts += 1
      return new Response('nope', { status: 500 })
    },
    async () => {
      controller.discover('bash')
      await settle()
      // The route can disappear for an instant while the Host re-applies the
      // entry, so one failure is retried instead of being reported.
      assert.equal(controller.store.getState().discovering, true)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const state = controller.store.getState()
      assert.equal(attempts, 2)
      assert.equal(state.discovering, false)
      // The status line is protocol detail; the row frames it with its own
      // translated sentence instead of surfacing `HTTP 500` as the message.
      assert.equal(state.error, 'row.requestFailed')
      assert.deepEqual(calls.at(-1), ['row.requestFailed', { detail: 'HTTP 500' }])
    },
  )
})

await test('a missing settings service reports instead of dropping the write', async () => {
  const controller = createRowController(undefined, (key) => key)
  controller.setBashPath('C:\\Git\\bin\\bash.exe')
  await settle()
  assert.equal(controller.store.getState().error, 'row.unavailable')
  assert.equal(controller.store.getState().saving, false)
})

await test('a rejected write shows the rejection message', async () => {
  const form = formStub()
  form.mutate = async () => false
  const controller = createRowController(form, (key) => key)
  // Switching kind also discovers, so the route has to answer; the rejection
  // must survive that read.
  await withFetch(jsonFetch({ candidates: [] }), async () => {
    controller.setDialect('bash')
    await settle()
    assert.equal(controller.store.getState().error, 'row.rejected')
  })
})

await test('a failed write carries the transport message', async () => {
  const form = formStub()
  form.mutate = async () => {
    throw new Error('offline')
  }
  const controller = createRowController(form, (key, params) => `${key}:${params.message}`)
  controller.setDialect('bash')
  await settle()
  assert.equal(controller.store.getState().error, 'row.saveFailed:offline')
})

await test('nothing is written when the row merely mounts', async () => {
  const form = formStub()
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({
      platform: 'win32',
      settingsAvailable: true,
      dialect: 'pwsh',
      bashPath: '',
      bashCandidates: [],
      capability: { supported: true },
    }),
    async () => {
      const stop = controller.start()
      await settle()
      stop()
    },
  )
  assert.deepEqual(form.mutations, [], 'mounting must not change the user configuration')
})

await test('a raced dialect write is retried, then the path is discovered', async () => {
  const form = formStub(undefined, { results: [false, true, true] })
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({ candidates: [{ path: 'C:\\WINDOWS\\system32\\cmd.exe', source: 'comspec', valid: true }] }),
    async () => {
      controller.setDialect('cmd')
      for (let index = 0; index < 4; index += 1) await settle()
      const state = controller.store.getState()
      assert.equal(state.error, undefined)
      assert.equal(state.saving, false)
      assert.equal(state.cmdPath, 'C:\\WINDOWS\\system32\\cmd.exe')
      assert.deepEqual(form.mutations, [
        [{ op: 'set', path: ['dialect'], value: 'cmd' }],
        [{ op: 'set', path: ['dialect'], value: 'cmd' }],
        [{ op: 'set', path: ['cmdPath'], value: 'C:\\WINDOWS\\system32\\cmd.exe' }],
      ])
    },
  )
})

await test('a still-refused dialect write is reported but the path is still discovered', async () => {
  const form = formStub(undefined, { results: [false, false, true] })
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({ candidates: [{ path: 'C:\\WINDOWS\\system32\\cmd.exe', source: 'comspec', valid: true }] }),
    async () => {
      controller.setDialect('cmd')
      for (let index = 0; index < 4; index += 1) await settle()
      const state = controller.store.getState()
      assert.equal(state.error, 'row.rejected')
      assert.equal(state.cmdPath, 'C:\\WINDOWS\\system32\\cmd.exe')
    },
  )
})

await test('a stale snapshot never blanks the optimistic path', async () => {
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [], cmdPath: '' }, { results: ['hang'] })
  const controller = createRowController(form, (key) => key)
  await withFetch(
    jsonFetch({
      platform: 'win32',
      settingsAvailable: true,
      dialect: 'cmd',
      bashPath: '',
      bashCandidates: [],
      cmdPath: '',
      capability: { supported: true },
      candidates: [],
    }),
    async () => {
      const stop = controller.start()
      await settle()
      controller.setCmdPath('C:\\Windows\\System32\\cmd.exe')
      await settle()
      assert.equal(controller.store.getState().saving, true)
      // The shared mirror republishes the pre-write snapshot while the write is
      // still in flight; the row must not drop what the user just chose.
      form.publish({ cmdPath: '' })
      await settle()
      assert.equal(controller.store.getState().cmdPath, 'C:\\Windows\\System32\\cmd.exe')
      form.release(true)
      await settle()
      assert.equal(controller.store.getState().saving, false)
      stop()
    },
  )
})

await test('discovery retries once across a transport error', async () => {
  let attempts = 0
  const form = formStub({ dialect: 'cmd', bashPath: '', bashCandidates: [], cmdPath: '' })
  const controller = createRowController(form, (key) => key)
  await withFetch(
    async () => {
      attempts += 1
      if (attempts === 1) throw new TypeError('fetch failed')
      return new Response(
        JSON.stringify({ candidates: [{ path: 'C:\\WINDOWS\\system32\\cmd.exe', source: 'comspec', valid: true }] }),
        { status: 200 },
      )
    },
    async () => {
      controller.discover('cmd')
      await settle()
      assert.equal(controller.store.getState().discovering, true)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const state = controller.store.getState()
      assert.equal(attempts, 2)
      assert.equal(state.error, undefined)
      assert.equal(state.cmdPath, 'C:\\WINDOWS\\system32\\cmd.exe')
    },
  )
})

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exitCode = 1
