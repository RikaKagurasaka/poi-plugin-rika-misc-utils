'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { summarize, costOf, inventory } = require('./logic')
const { normalize, createInputListener, createShortcuts } = require('./shortcuts')
const fixture = require('./test-data/master.json')
const state = (ships) => ({
  const: {
    $ships: Object.fromEntries(fixture.ships.map((s) => [s.api_id, s])),
    $shipUpgrades: fixture.upgrades,
  },
  info: {
    ships: Object.fromEntries(ships.map((s) => [s.api_id, s])),
    resources: [100, 200, 300, 400, 500, 600, 700, 800],
    useitems: { 58: { api_count: 7 } },
  },
})
const ship = (api_id, api_ship_id, api_lv) => ({ api_id, api_ship_id, api_lv })

test('all owned copies contribute spent materials; only the deepest first ship contributes pending', () => {
  const result = summarize(
    state([ship(10, 110, 170), ship(20, 461, 80), ship(30, 461, 80), ship(40, 461, 75)]),
  )
  assert.equal(result.plans.length, 1)
  assert.equal(result.plans[0].ship.api_id, 20)
  assert.equal(result.spent.blueprint, 3)
  assert.equal(result.spent.catapult, 3)
  assert.equal(result.pending.blueprint, 0)
  assert.equal(result.plans[0].target, 466)
  assert.deepEqual(
    result.plans[0].path.map((e) => [e.from, e.to]),
    [[461, 466]],
  )
})

test('an origin traverses each form once and stops before returning through the cycle', () => {
  const result = summarize(state([ship(1, 110, 1)]))
  assert.equal(result.plans[0].target, 466)
  assert.equal(result.pending.blueprint, 1)
  assert.equal(result.pending.catapult, 1)
  assert.equal(result.pending.development, 15)
  assert.equal(result.plans[0].path.length, 3)
})

test('a ship already at the last unique form has no remaining conversion costs', () => {
  const result = summarize(state([ship(1, 466, 100), ship(2, 110, 175)]))
  assert.equal(result.plans[0].ship.api_id, 1)
  assert.equal(result.plans[0].path.length, 0)
  assert.equal(result.spent.blueprint, 1)
  assert.equal(result.pending.development, 0)
  assert.deepEqual(result.plans[0].reachable, [466])
})

test('manual first ship and intermediate target are honoured; stale choices fall back', () => {
  const input = state([ship(1, 110, 100), ship(2, 461, 80)])
  const id = summarize(input).plans[0].id
  const manual = summarize(input, { [id]: { ship: 1, target: 288 } })
  assert.equal(manual.plans[0].target, 288)
  assert.equal(manual.pending.blueprint, 0)
  const stale = summarize(input, { [id]: { ship: 99, target: 123456 } })
  assert.equal(stale.plans[0].ship.api_id, 2)
  assert.equal(stale.plans[0].target, 466)
})

test('current client hardcoded costs: Musashi and Fubuki stages', () => {
  const musashi = summarize(state([ship(1, 546, 99)]))
  assert.equal(musashi.spent.blueprint, 3)
  assert.equal(musashi.spent.catapult, 0)
  assert.equal(musashi.spent.gun, 3)
  const fubuki = summarize(state([ship(1, 1040, 99)]))
  assert.equal(fubuki.spent.construction, 2746)
  assert.equal(fubuki.spent.development, 600)
  assert.equal(fubuki.spent.arsenal, 5)
  assert.equal(fubuki.spent.tech, 5)
})

test('fallback development threshold uses steel, blueprint exemption and source IDs', () => {
  assert.equal(
    costOf({ api_id: 9999, api_aftershipid: '10000', api_afterfuel: 5000 }).development,
    10,
  )
  assert.equal(
    costOf(
      { api_id: 9999, api_aftershipid: '10000', api_afterfuel: 5000 },
      { api_drawing_count: 1 },
    ).development,
    0,
  )
  assert.equal(
    costOf({ api_id: 503, api_aftershipid: '504', api_afterfuel: 6000 }, { api_drawing_count: 1 })
      .development,
    15,
  )
  assert.equal(costOf({ api_id: 136, api_aftershipid: '911' }).gun, 3)
  assert.equal(costOf({ api_id: 916, api_aftershipid: '911' }).gun, 0)
})

test('inventory distinguishes unknown from zero and uses poi zero-based resources', () => {
  assert.equal(inventory({}).blueprint, null)
  const input = state([])
  assert.equal(inventory(input).construction, 500)
  assert.equal(inventory(input).development, 700)
  assert.equal(inventory(input).blueprint, 7)
  assert.equal(inventory(input, true).report, 0)
  input.info.equips = {
    1: { api_slotitem_id: 87 },
    2: { api_slotitem_id: 87 },
    3: { api_slotitem_id: 1 },
  }
  assert.equal(inventory(input).boiler, 2)
})

test('pure cycle and missing master are reported without infinite traversal', () => {
  const input = {
    const: {
      $ships: {
        1: { api_id: 1, api_name: 'A', api_aftershipid: '2' },
        2: { api_id: 2, api_name: 'B', api_aftershipid: '1' },
      },
      $shipUpgrades: [],
    },
    info: { ships: { 1: ship(1, 1, 1), 2: ship(2, 999, 1) } },
  }
  const result = summarize(input)
  assert.equal(result.plans[0].path.length, 1)
  assert.equal(result.warnings.length, 2)
})

test('shortcut normalization supports DOM and Electron; rejects bare typing', () => {
  assert.equal(normalize({ key: 'r', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+R')
  assert.equal(normalize({ key: 'R', control: true, shift: true }), 'Ctrl+Shift+R')
  assert.equal(normalize({ key: 'F5' }), 'F5')
  assert.equal(normalize({ key: 'a' }), '')
  assert.equal(normalize({ key: 'Shift', shiftKey: true }), '')
  assert.equal(normalize({ key: 'r', meta: true }), 'Meta+R')
})

function contents(id) {
  const wc = new EventEmitter()
  wc.id = id
  wc.isDestroyed = () => false
  return wc
}
test('main-process interception prevents default before dispatch, handles edits/repeats and cleans up', () => {
  const wc = contents(1)
  const seen = []
  const listener = createInputListener(wc, { refresh: 'F5' }, (action) => seen.push(action))
  const press = (extra) =>
    wc.emit(
      'before-input-event',
      { preventDefault: () => seen.push('prevent') },
      { key: 'F5', type: 'keyDown', ...extra },
    )
  press()
  assert.deepEqual(seen, ['prevent', 'refresh'])
  press({ isAutoRepeat: true })
  press({ type: 'keyUp' })
  listener.update({ refresh: 'F5' }, true)
  press()
  assert.equal(seen.length, 2)
  listener.update({ reload: 'F5' }, false)
  press()
  assert.deepEqual(seen.slice(2), ['prevent', 'reload'])
  listener.stop()
  assert.equal(wc.listenerCount('before-input-event'), 0)
})

test('lifecycle attaches once, follows webview replacement and removes every hook', () => {
  const host = contents(1),
    game = contents(2),
    replacement = contents(3)
  let wc = game,
    notify,
    removed = false
  const store = {
    getState: () => ({ layout: { webview: { ref: { getWebContents: () => wc } } } }),
    subscribe: (fn) => {
      notify = fn
      return () => {
        removed = true
      }
    },
  }
  let calls = 0
  const shortcuts = createShortcuts({
    store,
    host,
    getBindings: () => ({ refresh: 'F5' }),
    actions: { refresh: () => calls++ },
    isEditing: () => false,
    onError: assert.fail,
  })
  shortcuts.start()
  shortcuts.start()
  assert.equal(host.listenerCount('before-input-event'), 1)
  game.emit('before-input-event', { preventDefault() {} }, { key: 'F5', type: 'keyDown' })
  assert.equal(calls, 1)
  wc = replacement
  notify()
  assert.equal(game.listenerCount('before-input-event'), 0)
  assert.equal(replacement.listenerCount('before-input-event'), 1)
  shortcuts.stop()
  assert.equal(host.listenerCount('before-input-event'), 0)
  assert.equal(replacement.listenerCount('before-input-event'), 0)
  assert.equal(removed, true)
})
