'use strict'

const isMouse = (key) => /(?:^|\+)MOUSE_(MIDDLE|BACK|FORWARD)$/.test(key || '')
function normalizeMouse(input) {
  const key = { 1: 'MOUSE_MIDDLE', 3: 'MOUSE_BACK', 4: 'MOUSE_FORWARD' }[input.button]
  if (!key) return ''
  return [
    input.ctrlKey && 'Ctrl',
    input.altKey && 'Alt',
    input.shiftKey && 'Shift',
    input.metaKey && 'Meta',
    key,
  ]
    .filter(Boolean)
    .join('+')
}

// Executed in each game frame. DOM button numbers retain back/forward buttons,
// which Electron's MouseInputEvent currently does not expose.
function installGameMouse(settings) {
  const slot = settings.token
  window[slot]?.()
  delete window[slot]
  if (settings.remove || !Object.keys(settings.bindings).length) return
  const handler = (event) => {
    if (!event.isTrusted || settings.paused) return
    const button = { 1: 'MOUSE_MIDDLE', 3: 'MOUSE_BACK', 4: 'MOUSE_FORWARD' }[event.button]
    if (!button) return
    const key = [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Meta',
      button,
    ]
      .filter(Boolean)
      .join('+')
    const action = Object.entries(settings.bindings).find(([, binding]) => binding === key)?.[0]
    if (!['refresh', 'reload'].includes(action)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'mousedown') console.debug(settings.token + action)
  }
  for (const type of ['mousedown', 'mouseup', 'auxclick'])
    window.addEventListener(type, handler, true)
  window[slot] = () => {
    for (const type of ['mousedown', 'mouseup', 'auxclick'])
      window.removeEventListener(type, handler, true)
  }
}

function createMouseListener(contents, bindings, onAction, onError) {
  const token = '__rikaMouse_' + require('crypto').randomBytes(16).toString('hex')
  let settings = { token, bindings, paused: false }
  let stopped = false
  function inject() {
    if (contents.isDestroyed()) return
    const script = `(${installGameMouse.toString()})(${JSON.stringify(settings)})`
    try {
      for (const frame of contents.mainFrame.framesInSubtree) {
        if (frame.isDestroyed()) continue
        // Frames may disappear during navigation; report errors only for a live frame.
        frame.executeJavaScript(script).catch((error) => {
          if (!stopped && !frame.isDestroyed()) onError(error)
        })
      }
    } catch (error) {
      if (!stopped && !contents.isDestroyed()) onError(error)
    }
  }
  const receive = (details) => {
    if (stopped || settings.paused || typeof details?.message !== 'string') return
    if (!details.message.startsWith(token)) return
    const action = details.message.slice(token.length)
    if (['refresh', 'reload'].includes(action) && isMouse(settings.bindings[action]))
      onAction(action)
  }
  try {
    contents.on('console-message', receive)
    contents.on('did-frame-finish-load', inject)
    inject()
  } catch (error) {
    if (!contents.isDestroyed()) {
      contents.removeListener('console-message', receive)
      contents.removeListener('did-frame-finish-load', inject)
    }
    throw error
  }
  return {
    update(next, paused) {
      const changed =
        JSON.stringify(settings.bindings) !== JSON.stringify(next) || settings.paused !== paused
      settings = { token, bindings: next, paused }
      if (changed) inject()
    },
    stop() {
      stopped = true
      if (contents.isDestroyed()) return
      contents.removeListener('console-message', receive)
      contents.removeListener('did-frame-finish-load', inject)
      settings = { token, remove: true }
      inject()
    },
  }
}

function normalize(input) {
  let key = String(input.key || '').toUpperCase()
  if (key === ' ') key = 'SPACE'
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|SPACE|HOME|END|PAGEUP|PAGEDOWN|INSERT|DELETE|ARROW(?:UP|DOWN|LEFT|RIGHT))$/.test(
      key,
    )
  )
    return ''
  const mods = []
  if (input.control || input.ctrlKey) mods.push('Ctrl')
  if (input.alt || input.altKey) mods.push('Alt')
  if (input.shift || input.shiftKey) mods.push('Shift')
  if (input.meta || input.metaKey) mods.push('Meta')
  // Single function keys are allowed; other keys need Ctrl/Alt/Meta.
  if (!/^F\d+$/.test(key) && !mods.some((m) => m !== 'Shift')) return ''
  return [...mods, key].join('+')
}

// Runs in Electron's main process: preventDefault must happen synchronously,
// before sending the selected action back to the renderer through @electron/remote.
function createInputListener(contents, initialBindings, onAction) {
  let bindings = initialBindings
  let suspended = false
  const listener = (event, input) => {
    if (suspended || input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return
    const key = normalize(input)
    if (!key) return
    const action = Object.entries(bindings).find(([, binding]) => binding === key)?.[0]
    if (!['refresh', 'reload'].includes(action)) return
    event.preventDefault()
    onAction(action)
  }
  contents.on('before-input-event', listener)
  return {
    update(next, paused) {
      bindings = next
      suspended = paused
    },
    stop() {
      if (!contents.isDestroyed()) contents.removeListener('before-input-event', listener)
    },
  }
}

function watchGlobalShortcutReset(onReset) {
  const { ipcMain } = require('electron')
  let active = true
  const listener = () =>
    queueMicrotask(() => {
      if (active) onReset()
    })
  ipcMain.on('refresh-shortcut', listener)
  return {
    stop() {
      active = false
      ipcMain.removeListener('refresh-shortcut', listener)
    },
  }
}

function createShortcuts({
  store,
  host,
  getBindings,
  actions,
  isEditing,
  onError,
  globalShortcut,
  getGlobal = () => false,
  createMouseListener: listenMouse,
  watchGlobalShortcutReset: watchReset,
  createInputListener: listen = createInputListener,
}) {
  let unsubscribe = null
  let resetWatcher = null
  let running = false
  const attached = new Map()
  const registered = new Map()
  let lastTrigger = 0
  function invoke(action) {
    if (!running || isEditing() || !actions[action]) return
    if (Date.now() - lastTrigger < 700) return
    lastTrigger = Date.now()
    try {
      Promise.resolve(actions[action]()).catch(onError)
    } catch (error) {
      onError(error)
    }
  }
  const localBindings = () =>
    getGlobal()
      ? {}
      : Object.fromEntries(Object.entries(getBindings()).filter(([, key]) => !isMouse(key)))
  const mouseBindings = () =>
    Object.fromEntries(Object.entries(getBindings()).filter(([, key]) => isMouse(key)))
  function updateGlobal() {
    if (!globalShortcut) return
    const desired = new Map()
    if (getGlobal() && !isEditing()) {
      for (const [action, key] of Object.entries(getBindings())) {
        if (key && !isMouse(key))
          desired.set(key.replace(/ARROW(UP|DOWN|LEFT|RIGHT)$/, '$1'), action)
      }
    }
    for (const [key, action] of registered) {
      if (!globalShortcut.isRegistered(key)) {
        registered.delete(key)
      } else if (desired.get(key) !== action) {
        globalShortcut.unregister(key)
        registered.delete(key)
      }
    }
    for (const [key, action] of desired) {
      if (registered.has(key)) continue
      try {
        if (!globalShortcut.register(key, () => invoke(action))) {
          onError(new Error(`全局快捷键 ${key} 注册失败，可能已被其他应用占用。`))
        } else registered.set(key, action)
      } catch (error) {
        onError(error)
      }
    }
  }
  function attach(contents) {
    if (!contents || contents.isDestroyed() || attached.has(contents.id)) return
    const listener = listen(contents, localBindings(), invoke)
    // Record each acquired resource before the next operation can throw.
    const item = { contents, listener, mouse: null }
    attached.set(contents.id, item)
    listener.update(localBindings(), isEditing())
    item.mouse =
      contents.id !== host.id && listenMouse
        ? listenMouse(contents, mouseBindings(), invoke, onError)
        : null
    item.mouse?.update(mouseBindings(), isEditing())
  }
  function sync() {
    const active = new Set([host.id])
    attach(host)
    let game
    try {
      game = store.getState().layout?.webview?.ref?.getWebContents()
    } catch {
      /* The webview can be between detach and dom-ready. */
    }
    if (game && !game.isDestroyed()) {
      active.add(game.id)
      attach(game)
    }
    for (const [id, item] of attached) {
      if (!active.has(id) || item.contents.isDestroyed()) {
        item.listener.stop()
        item.mouse?.stop()
        attached.delete(id)
      }
    }
  }
  function stop() {
    running = false
    const safely = (cleanup) => {
      try {
        cleanup()
      } catch (error) {
        onError(error)
      }
    }
    safely(() => unsubscribe?.())
    unsubscribe = null
    safely(() => resetWatcher?.stop())
    resetWatcher = null
    for (const { listener, mouse } of attached.values()) {
      safely(() => listener.stop())
      safely(() => mouse?.stop())
    }
    attached.clear()
    for (const key of registered.keys()) safely(() => globalShortcut.unregister(key))
    registered.clear()
  }
  return {
    start() {
      if (running) return
      try {
        running = true
        sync()
        updateGlobal()
        resetWatcher = watchReset?.(() => {
          if (!running) return
          // poi just unregistered everything; any newly registered boss key is not ours.
          registered.clear()
          try {
            updateGlobal()
          } catch (error) {
            onError(error)
          }
        })
        unsubscribe = store.subscribe(() => {
          try {
            sync()
          } catch (error) {
            stop()
            onError(error)
          }
        })
      } catch (error) {
        stop()
        throw error
      }
    },
    update() {
      if (!running) return
      for (const { listener, mouse } of attached.values()) {
        listener.update(localBindings(), isEditing())
        mouse?.update(mouseBindings(), isEditing())
      }
      updateGlobal()
    },
    stop,
  }
}

module.exports = {
  normalize,
  normalizeMouse,
  isMouse,
  createInputListener,
  createMouseListener,
  createShortcuts,
  watchGlobalShortcutReset,
}
