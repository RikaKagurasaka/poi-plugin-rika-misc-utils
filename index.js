'use strict'

const React = require('react')
const { store } = require('views/create-store')
const { MaterialIcon } = require('views/components/etc/icon')
const { gameRefreshPage, gameReload } = require('views/services/utils')
const remote = require('@electron/remote')
// Released poi versions do not all export config from views/env.
const config = remote.require('./lib/config')
const { normalize, normalizeMouse, isMouse, createShortcuts } = require('./shortcuts')
const { summarize, materials } = require('./logic')
const h = React.createElement
const prefix = 'plugin.rikaMiscUtils'
const readBindings = () => config.get(`${prefix}.shortcuts`, { refresh: '', reload: '' })
const readGlobal = () => config.get(`${prefix}.globalShortcuts`, false)
const bindingLabel = (key) =>
  (key || '')
    .replace('MOUSE_MIDDLE', '鼠标中键')
    .replace('MOUSE_BACK', '鼠标后退侧键')
    .replace('MOUSE_FORWARD', '鼠标前进侧键')
let shortcuts = null
let recording = false
let itemSnapshot = { account: null, loaded: false, stale: true }
const subscribers = new Set()
const subscribe = (fn) => {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}
const notify = () => subscribers.forEach((fn) => fn())
let errorMessage = ''
const reportError = (error) => {
  errorMessage = String(error.message || error)
  notify()
}
const editing = () =>
  document.hasFocus() &&
  (recording ||
    Boolean(document.activeElement?.closest('input,textarea,select,[contenteditable="true"]')))
function response(event) {
  const detail = event.detail
  if (!detail) return
  const account = store.getState().info?.basic?.api_member_id
  if (
    /\/api_get_member\/(useitem|require_info)$/.test(detail.path) &&
    (Array.isArray(detail.body) || detail.body?.api_useitem)
  ) {
    itemSnapshot = { account, loaded: true, stale: false }
    notify()
  } else if (/\/api_req_/.test(detail.path)) {
    itemSnapshot = { ...itemSnapshot, stale: true }
    notify()
  }
}
function start() {
  if (shortcuts) return
  shortcuts = createShortcuts({
    store,
    host: remote.getCurrentWebContents(),
    getBindings: readBindings,
    actions: { refresh: gameRefreshPage, reload: gameReload },
    isEditing: editing,
    onError: reportError,
    globalShortcut: remote.globalShortcut,
    getGlobal: readGlobal,
    createInputListener: remote.require(require.resolve('./shortcuts')).createInputListener,
    createMouseListener: remote.require(require.resolve('./shortcuts')).createMouseListener,
  })
  shortcuts.start()
  window.addEventListener('game.response', response)
  window.addEventListener('focusin', syncEditing)
  window.addEventListener('focusout', syncEditing)
  window.addEventListener('focus', syncEditing)
  window.addEventListener('blur', syncEditing)
}
function syncEditing() {
  queueMicrotask(() => shortcuts?.update())
}
function stop() {
  shortcuts?.stop()
  shortcuts = null
  recording = false
  window.removeEventListener('game.response', response)
  window.removeEventListener('focusin', syncEditing)
  window.removeEventListener('focusout', syncEditing)
  window.removeEventListener('focus', syncEditing)
  window.removeEventListener('blur', syncEditing)
}

const fmt = (value) => (value == null ? '—' : value.toLocaleString('zh-CN'))
const materialLabel = ([, label, kind, id]) =>
  kind === 'resource'
    ? h(
        'span',
        { className: 'rika-material', title: label },
        h(MaterialIcon, { materialId: id + 1, alt: label }),
      )
    : label
const css = `
.rika-misc{padding:12px;overflow:auto;height:100%;box-sizing:border-box;font-size:13px}
.rika-misc nav{display:flex;gap:8px;border-bottom:1px solid #8886;padding-bottom:10px;margin-bottom:14px}
.rika-misc button,.rika-misc input:not([type=checkbox]),.rika-misc select{font:inherit;color:inherit;background:transparent;border:1px solid #8888;border-radius:3px;padding:5px 8px}
.rika-misc button{cursor:pointer}.rika-misc button[aria-selected=true]{border-color:#4b9cce;background:#4b9cce22}
.rika-misc p{line-height:1.6}.rika-misc .muted{opacity:.72}.rika-misc .warning{color:#cf903a}
.rika-misc table{border-collapse:collapse;width:100%;margin:12px 0}.rika-misc th,.rika-misc td{border-bottom:1px solid #8884;padding:7px;text-align:left;vertical-align:top}
.rika-misc .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.rika-misc .short-row{display:grid;grid-template-columns:6.5em minmax(0,1fr) 7.5em auto;align-items:center;gap:6px;margin:16px 0}
.rika-misc select{max-width:260px}.rika-misc option{color:#222;background:#fff}
.rika-misc .global-toggle{display:inline-flex;align-items:center;gap:7px;margin:4px 0 8px;cursor:pointer}
.rika-misc .global-toggle input{appearance:auto;width:14px;height:14px;margin:0;padding:0;border:0;box-shadow:none}
.rika-misc .short-row>label{min-width:0;white-space:nowrap}
.rika-misc .short-row input{box-sizing:border-box;width:100%;min-width:0;padding:6px 3px;border:0;border-bottom:1px solid #8888;border-radius:0;text-overflow:ellipsis}
.rika-misc .short-row input:focus{outline:none;border-bottom:2px solid #4b9cce;background:#4b9cce12}
.rika-misc .short-row input::placeholder{color:inherit;opacity:.6}
.rika-misc .short-row input:focus::placeholder{color:#78bce6;opacity:1}
.rika-misc .shortcut-choice{position:relative;min-width:0}
.rika-misc .shortcut-choice::after{content:'▾';position:absolute;right:3px;top:50%;transform:translateY(-50%);pointer-events:none}
.rika-misc .shortcut-choice select{appearance:none;box-sizing:border-box;width:100%;min-width:0;max-width:none;border:0;border-bottom:1px solid #8888;border-radius:0;padding:6px 16px 6px 3px;cursor:pointer;text-overflow:ellipsis}
.rika-misc .short-row .shortcut-clear{border:0;padding:5px 0 5px 3px;white-space:nowrap;opacity:.7}
.rika-misc .short-row .shortcut-clear:hover{opacity:1;text-decoration:underline}
.rika-misc .shortcut-status{min-height:1.6em;margin:8px 0}
.rika-misc summary{cursor:pointer;margin:12px 0}.rika-misc .table-wrap{overflow:auto}
.rika-misc .rika-material{display:inline-flex;align-items:center;gap:5px;vertical-align:middle}
.rika-misc .material-filter{margin:16px 0;display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.rika-misc .detail-table{table-layout:fixed}
.rika-misc .detail-table td{overflow-wrap:anywhere}
.rika-misc .ship-meta{display:block;font-size:12px;margin-top:3px;opacity:.72}
.rika-misc .notes{margin-top:20px;border-top:1px solid #8884;padding-top:8px}
`

function ShortcutsTab() {
  const [bindings, setBindings] = React.useState(readBindings)
  const [globalEnabled, setGlobalEnabled] = React.useState(readGlobal)
  const [message, setMessage] = React.useState('')
  const [recordingAction, setRecordingAction] = React.useState(null)
  React.useEffect(
    () => () => {
      recording = false
      syncEditing()
    },
    [],
  )
  function save(action, key) {
    if (
      key &&
      Object.entries(bindings).some(([other, value]) => other !== action && value === key)
    ) {
      setMessage('两个操作不能使用相同快捷键。')
      return
    }
    try {
      const next = { ...bindings, [action]: key }
      config.set(`${prefix}.shortcuts`, next)
      setBindings(next)
      errorMessage = ''
      shortcuts?.update()
      notify()
      setMessage('已保存')
      return true
    } catch (error) {
      setMessage(`保存失败：${error.message}`)
    }
  }
  return h(
    'section',
    null,
    h(
      'label',
      { className: 'global-toggle' },
      h('input', {
        type: 'checkbox',
        checked: globalEnabled,
        onChange: (event) => {
          try {
            const enabled = event.target.checked
            config.set(`${prefix}.globalShortcuts`, enabled)
            setGlobalEnabled(enabled)
            errorMessage = ''
            shortcuts?.update()
            notify()
          } catch (error) {
            setMessage(`保存失败：${error.message}`)
          }
        },
      }),
      ' 键盘全局监听',
    ),
    ...[
      ['refresh', '刷新游戏网页'],
      ['reload', '重载游戏框架'],
    ].map(([action, label]) =>
      h(
        'div',
        { className: 'short-row', key: action },
        h('label', { htmlFor: `rika-${action}` }, label),
        h('input', {
          id: `rika-${action}`,
          readOnly: true,
          value: recordingAction === action ? '' : bindingLabel(bindings[action]),
          placeholder: recordingAction === action ? '请按快捷键…' : '点击录入',
          title: bindingLabel(bindings[action]) || '点击录入快捷键',
          'aria-describedby': 'rika-shortcut-status',
          onFocus: () => {
            recording = true
            setRecordingAction(action)
            setMessage('')
            syncEditing()
          },
          onBlur: () => {
            recording = false
            setRecordingAction(null)
            syncEditing()
          },
          onKeyDown: (event) => {
            if (event.key === 'Tab') return
            event.preventDefault()
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.currentTarget.blur()
              return
            }
            if (event.repeat || event.isComposing || event.nativeEvent?.isComposing) return
            const key = normalize(event)
            if (key && save(action, key)) event.currentTarget.blur()
          },
          onMouseDown: (event) => {
            const key = normalizeMouse(event)
            if (!key) return
            event.preventDefault()
            event.stopPropagation()
            if (save(action, key)) event.currentTarget.blur()
          },
          onMouseUp: (event) => {
            if (normalizeMouse(event)) event.preventDefault()
          },
          onAuxClick: (event) => {
            if (normalizeMouse(event)) event.preventDefault()
          },
        }),
        h(
          'div',
          { className: 'shortcut-choice' },
          h(
            'select',
            {
              'aria-label': `${label}按键类型`,
              value: isMouse(bindings[action]) ? bindings[action] : '',
              onChange: (event) => save(action, event.target.value),
            },
            h('option', { value: '' }, '键盘'),
            ...[
              ['MOUSE_MIDDLE', '鼠标中键'],
              ['MOUSE_BACK', '鼠标后退侧键'],
              ['MOUSE_FORWARD', '鼠标前进侧键'],
            ].map(([key, title]) => h('option', { key, value: key }, title)),
            isMouse(bindings[action]) &&
              bindings[action].includes('+') &&
              h('option', { value: bindings[action] }, bindingLabel(bindings[action])),
          ),
        ),
        h('button', { className: 'shortcut-clear', onClick: () => save(action, '') }, '清除'),
      ),
    ),
    h(
      'p',
      { id: 'rika-shortcut-status', className: 'shortcut-status muted', role: 'status' },
      message ||
        (recordingAction
          ? '正在录入：请按键盘组合键或鼠标功能键，Esc 取消。'
          : '点击录入快捷键，或从下拉框选择鼠标按键。'),
    ),
    h(
      'p',
      { className: 'muted' },
      '键盘全局监听开启后，切换到其他应用也可触发。鼠标绑定始终仅在游戏区域生效，并阻止该按键在游戏中的默认操作。快捷键直接执行刷新，不弹确认框；录入及在 poi 文本框中输入时暂停触发。Meta 在 macOS 上是 Command 键。',
    ),
  )
}

function StatsTab({ state }) {
  const account = state.info?.basic?.api_member_id
  const [selectedMaterial, setSelectedMaterial] = React.useState('construction')
  const snapshot = React.useSyncExternalStore(subscribe, () => itemSnapshot)
  const knownItems =
    (snapshot.account === account && snapshot.loaded) ||
    Object.keys(state.info?.useitems || {}).length > 0
  const result = React.useMemo(
    () => summarize(state, {}, knownItems),
    [
      state.const,
      state.info?.ships,
      state.info?.resources,
      state.info?.useitems,
      state.info?.equips,
      knownItems,
    ],
  )
  const name = (id) => result.graph.ships[id]?.api_name || `#${id}`
  const shipLabel = (ship) =>
    h(
      'div',
      null,
      h('span', null, name(ship.api_ship_id)),
      h('span', { className: 'ship-meta' }, `Lv.${ship.api_lv} · #${ship.api_id}`),
    )
  const visibleRows = (rows) =>
    rows
      .filter((row) => row.cost[selectedMaterial] > 0)
      .sort(
        (a, b) =>
          b.cost[selectedMaterial] - a.cost[selectedMaterial] || a.ship.api_id - b.ship.api_id,
      )
  const pendingRows = visibleRows(result.plans)
  const spentRows = visibleRows(result.details)
  if (
    !account ||
    !Object.keys(state.const?.$ships || {}).length ||
    !Object.keys(state.info?.ships || {}).length
  ) {
    return h('p', null, '等待舰船与主数据。请登录游戏并返回母港；已登录时可刷新游戏网页。')
  }
  return h(
    'section',
    null,
    h(
      'div',
      { className: 'table-wrap' },
      h(
        'table',
        null,
        h(
          'thead',
          null,
          h(
            'tr',
            null,
            ...['道具', '已消耗', '待消耗', '库存', '缺口'].map((title, i) =>
              h('th', { key: title, className: i ? 'num' : undefined }, title),
            ),
          ),
        ),
        h(
          'tbody',
          null,
          ...materials.map((material) => {
            const [key] = material
            return h(
              'tr',
              { key },
              h('td', null, materialLabel(material)),
              ...[
                result.spent[key],
                result.pending[key],
                result.stock[key],
                result.stock[key] == null
                  ? null
                  : Math.max(0, result.pending[key] - result.stock[key]),
              ].map((value, i) => h('td', { className: 'num', key: i }, fmt(value))),
            )
          }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'material-filter' },
      h('label', { htmlFor: 'rika-detail-material' }, '消耗明细'),
      h(
        'select',
        {
          id: 'rika-detail-material',
          value: selectedMaterial,
          onChange: (event) => setSelectedMaterial(event.target.value),
        },
        ...materials.map(([key, label]) => h('option', { key, value: key }, label)),
      ),
    ),
    h(
      'details',
      null,
      h('summary', null, '待消耗明细'),
      !pendingRows.length
        ? h('p', { className: 'muted' }, '没有需要消耗此项道具的舰船。')
        : h(
            'table',
            { className: 'detail-table' },
            h(
              'colgroup',
              null,
              h('col', { style: { width: '42%' } }),
              h('col', { style: { width: '38%' } }),
              h('col', { style: { width: '20%' } }),
            ),
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                h('th', null, '舰船'),
                h('th', null, '目标形态'),
                h('th', { className: 'num' }, '数量'),
              ),
            ),
            h(
              'tbody',
              null,
              ...pendingRows.map((row) =>
                h(
                  'tr',
                  { key: row.id },
                  h('td', null, shipLabel(row.ship)),
                  h('td', null, name(row.target)),
                  h('td', { className: 'num' }, fmt(row.cost[selectedMaterial])),
                ),
              ),
            ),
          ),
    ),
    h(
      'details',
      null,
      h('summary', null, '已消耗明细'),
      !spentRows.length
        ? h('p', { className: 'muted' }, '没有消耗过此项道具的舰船。')
        : h(
            'table',
            { className: 'detail-table' },
            h(
              'colgroup',
              null,
              h('col', { style: { width: '80%' } }),
              h('col', { style: { width: '20%' } }),
            ),
            h(
              'thead',
              null,
              h('tr', null, h('th', null, '舰船'), h('th', { className: 'num' }, '数量')),
            ),
            h(
              'tbody',
              null,
              ...spentRows.map((row) =>
                h(
                  'tr',
                  { key: row.ship.api_id },
                  h('td', null, shipLabel(row.ship)),
                  h('td', { className: 'num' }, fmt(row.cost[selectedMaterial])),
                ),
              ),
            ),
          ),
    ),
    h(
      'div',
      { className: 'notes' },
      h(
        'p',
        { className: 'muted' },
        `现有舰船 ${result.details.length} 艘；按改造链选取 ${result.plans.length} 艘，其中 ${result.plans.filter((p) => p.path.length).length} 艘尚有待改造阶段。`,
      ),
      h(
        'p',
        { className: 'muted' },
        '已消耗为现有每艘舰船从初始形态到当前形态的重建估算，不是历史账本。循环改造每个形态最多计一次；不含已拆解、合成、轰沉的舰船，也无法识别直接获得的改造形态。',
      ),
      h(
        'p',
        { className: 'muted' },
        '待消耗每条改造链按改造进度最深、等级最高、取得最早依次选取一艘，继续到最后一个未访问形态。明细仅显示所选道具有消耗的舰船，按数量降序排列。',
      ),
      h(
        'p',
        { className: 'muted' },
        '库存取 poi 最近收到的数据；“—”表示未取得。道具库存可能滞后，请打开游戏道具栏更新。锅炉库存含已装备、已锁定及已改修装备，不代表可直接消耗数量。',
      ),
      h(
        'p',
        { className: 'muted' },
        '规则：游戏客户端 6.3.5.0；特殊道具数量同时读取当前游戏主数据。游戏更新后客户端硬编码的消耗规则需要随插件更新。',
      ),
      (snapshot.account !== account || snapshot.stale) &&
        h('p', { className: 'warning' }, '尚未确认最新完整道具库存，库存与缺口仅供参考。'),
      ...result.warnings.map((w) => h('p', { className: 'warning', key: w }, w)),
    ),
  )
}

function App() {
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const error = React.useSyncExternalStore(subscribe, () => errorMessage)
  const [tab, setTab] = React.useState('stats')
  return h(
    'div',
    { className: 'rika-misc' },
    h('style', null, css),
    h(
      'nav',
      { role: 'tablist', 'aria-label': '杂项工具' },
      ...[
        ['stats', '改造资材统计'],
        ['shortcuts', '快捷键'],
      ].map(([id, title]) =>
        h(
          'button',
          {
            key: id,
            role: 'tab',
            id: `rika-tab-${id}`,
            'aria-controls': 'rika-panel',
            'aria-selected': tab === id,
            onClick: () => setTab(id),
          },
          title,
        ),
      ),
    ),
    h(
      'div',
      { role: 'tabpanel', id: 'rika-panel', 'aria-labelledby': `rika-tab-${tab}` },
      tab === 'shortcuts'
        ? h(ShortcutsTab)
        : h(StatsTab, { key: state.info?.basic?.api_member_id || 'offline', state }),
    ),
    error && h('p', { role: 'alert' }, error),
  )
}

exports.reactClass = App
exports.windowMode = false
exports.pluginDidLoad = start
exports.pluginWillUnload = stop
