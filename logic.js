'use strict'

const rules = require('./data/client-costs.json')
const materials = [
  ['construction', '高速建造材（喷火）', 'resource', 4],
  ['development', '开发资材', 'resource', 6],
  ['screws', '改修资材', 'resource', 7],
  ['blueprint', '改装设计图', 'item', 58, 'api_drawing_count'],
  ['catapult', '试制甲板弹射器', 'item', 65, 'api_catapult_count'],
  ['report', '战斗详报', 'item', 78, 'api_report_count'],
  ['gun', '新型炮熕兵装资材', 'item', 75],
  ['aviation', '新型航空兵装资材', 'item', 77, 'api_aviation_mat_count'],
  ['arms', '新型兵装资材', 'item', 94, 'api_arms_mat_count'],
  ['tech', '海外舰最新技术', 'item', 100, 'api_tech_count'],
  ['arsenal', '工厂资源', 'item', 104],
  ['boiler', '新型高温高压锅炉', 'equipment', 87, 'api_boiler_count'],
]
const empty = () => Object.fromEntries(materials.map(([key]) => [key, 0]))
const add = (total, cost) =>
  materials.forEach(([key]) => {
    total[key] += cost[key]
  })
const number = (value) => Math.max(0, Number(value) || 0)

function costOf(ship, upgrade = {}) {
  const cost = empty()
  const from = Number(ship.api_id)
  const to = Number(ship.api_aftershipid)
  if (!to) return cost
  // Steel is only an input to the client's development-material rule, not a statistic.
  const steel = number(ship.api_afterfuel)
  for (const [key, , , , field] of materials) {
    if (field) cost[key] = number(upgrade[field])
  }
  cost.development =
    rules.development[from] ??
    ((cost.blueprint && !rules.blueprintDevelopmentExceptions.includes(from)) || steel < 4500
      ? 0
      : steel < 5500
        ? 10
        : steel < 6500
          ? 15
          : 20)
  cost.construction = rules.construction[from] || 0
  cost.gun = to === 911 ? (from === 136 ? 3 : 0) : rules.gunMaterialByTarget[to] || 0
  cost.screws = to === 975 ? 5 : 0
  cost.arsenal = rules.arsenalMaterialByTarget[to] || 0
  return cost
}

function buildGraph(masters, upgrades = []) {
  const ships = Object.fromEntries(
    Object.values(masters)
      .filter((s) => s.api_id <= 1500)
      .map((s) => [s.api_id, s]),
  )
  const edges = new Map()
  const incoming = new Set()
  const neighbours = new Map(Object.keys(ships).map((id) => [Number(id), new Set()]))
  for (const ship of Object.values(ships)) {
    const from = ship.api_id
    const to = Number(ship.api_aftershipid)
    if (!to || !ships[to]) continue
    const upgrade = upgrades.find(
      (u) => Number(u.api_current_ship_id) === from && Number(u.api_id) === to,
    )
    edges.set(from, { from, to, cost: costOf(ship, upgrade) })
    incoming.add(to)
    neighbours.get(from).add(to)
    neighbours.get(to).add(from)
  }
  const groups = []
  const groupOf = new Map()
  for (const id of neighbours.keys()) {
    if (groupOf.has(id)) continue
    const ids = [id]
    const seen = new Set(ids)
    for (const next of ids)
      for (const n of neighbours.get(next)) {
        if (!seen.has(n)) {
          seen.add(n)
          ids.push(n)
        }
      }
    const roots = ids.filter((n) => !incoming.has(n))
    const group = { id: Math.min(...ids), ids, roots }
    groups.push(group)
    ids.forEach((n) => groupOf.set(n, group))
  }
  return { ships, edges, groups, groupOf }
}

function pathTo(graph, from, to) {
  const path = []
  const seen = new Set()
  while (from !== to) {
    if (seen.has(from) || !graph.edges.has(from)) return null
    seen.add(from)
    const edge = graph.edges.get(from)
    path.push(edge)
    from = edge.to
  }
  return path
}

// A canonical origin-to-current path has already visited those earlier forms.
function defaultTarget(graph, from, visited = []) {
  const seen = new Set(visited)
  seen.add(from)
  while (true) {
    const edge = graph.edges.get(from)
    if (!edge || seen.has(edge.to)) return from
    from = edge.to
    seen.add(from)
  }
}

function inventory(state, knownItems = false) {
  return Object.fromEntries(
    materials.map(([key, , kind, id]) => {
      let value = null
      if (kind === 'resource') value = state.info?.resources?.[id] ?? null
      if (kind === 'item') value = state.info?.useitems?.[id]?.api_count ?? (knownItems ? 0 : null)
      if (kind === 'equipment' && state.info?.equips && Object.keys(state.info.equips).length) {
        value = Object.values(state.info.equips).filter((e) => e.api_slotitem_id === id).length
      }
      return [key, value]
    }),
  )
}

function summarize(state, choices = {}, knownItems = false) {
  const graph = buildGraph(state.const?.$ships || {}, state.const?.$shipUpgrades || [])
  const spent = empty()
  const pending = empty()
  const owned = Object.values(state.info?.ships || {})
  const warnings = new Set()
  const members = new Map()
  const details = []
  const history = new Map()
  if (!state.const?.$shipUpgrades) warnings.add('改造主数据尚未加载，特殊道具消耗不完整。')
  for (const ship of owned) {
    const group = graph.groupOf.get(ship.api_ship_id)
    if (!group) {
      warnings.add(`舰船 #${ship.api_ship_id} 缺少主数据，未计入。`)
      continue
    }
    if (!members.has(group.id)) members.set(group.id, [])
    members.get(group.id).push(ship)
    const paths = group.roots.map((root) => pathTo(graph, root, ship.api_ship_id)).filter(Boolean)
    paths.sort((a, b) => a.length - b.length)
    const path = paths[0]
    history.set(ship.api_id, path || [])
    if (!path || paths.length > 1)
      warnings.add(
        `${graph.ships[ship.api_ship_id].api_name}：初始形态不唯一或为纯循环，已消耗估算可能不完整。`,
      )
    const cost = empty()
    if (path) path.forEach((edge) => add(cost, edge.cost))
    add(spent, cost)
    details.push({ ship, cost, path })
  }
  const plans = []
  for (const [id, ships] of members) {
    ships.sort(
      (a, b) =>
        history.get(b.api_id).length - history.get(a.api_id).length ||
        number(b.api_lv) - number(a.api_lv) ||
        a.api_id - b.api_id,
    )
    const choice = choices[id] || {}
    const ship = ships.find((s) => s.api_id === Number(choice.ship)) || ships[0]
    const reachable = [ship.api_ship_id]
    const visited = new Set(history.get(ship.api_id).map((edge) => edge.from))
    while (graph.edges.has(reachable.at(-1))) {
      const next = graph.edges.get(reachable.at(-1)).to
      if (reachable.includes(next) || visited.has(next)) break
      reachable.push(next)
    }
    const target = reachable.includes(Number(choice.target))
      ? Number(choice.target)
      : defaultTarget(
          graph,
          ship.api_ship_id,
          history.get(ship.api_id).map((edge) => edge.from),
        )
    const path = pathTo(graph, ship.api_ship_id, target) || []
    const cost = empty()
    path.forEach((edge) => add(cost, edge.cost))
    add(pending, cost)
    plans.push({ id, ships, ship, target, reachable, path, cost })
  }
  return {
    graph,
    spent,
    pending,
    plans,
    details,
    stock: inventory(state, knownItems),
    warnings: [...warnings],
  }
}

module.exports = { materials, costOf, buildGraph, pathTo, defaultTarget, summarize, inventory }
