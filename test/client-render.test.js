import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZOD_REQUIRED, loadBundle } from './helpers/bundle.js'

/**
 * A store stub for the collapsed entry.
 * @param {object} view View fields the entry reads.
 * @returns {object} The store.
 */
function store(view) {
  return {
    getSnapshot: () => view,
    subscribe: () => () => {},
  }
}

describe('collapsed footer entry', () => {
  it('owns its stylesheet when the panel and notice are not mounted', ZOD_REQUIRED, () => {
    const FooterEntry = loadBundle().exports.get('dsh-plugin-updater').FooterEntry
    const tree = FooterEntry({
      wide: false,
      store: store({ total: 0, current: true, rows: [], checking: false, updating: false, busy: false }),
      openPanel: () => {},
    })
    assert.equal(tree.type, 'Fragment')
    const styles = tree.children[0].type()
    assert.equal(styles.type, 'style')
    assert.equal(styles.props['data-plugin-updater'], '')
    assert.equal(tree.children[1].props.className, 'updater-footer-rail')
  })

  it('names the failure and the progress while collapsed', ZOD_REQUIRED, () => {
    const FooterEntry = loadBundle().exports.get('dsh-plugin-updater').FooterEntry
    const tree = FooterEntry({
      wide: false,
      store: store({ total: 3, current: false, rows: [], checking: true, updating: false, busy: false }),
      openPanel: () => {},
    })
    const rail = tree.children[1]
    assert.match(rail.props['aria-label'], /Plugin Updater/)
    assert.match(rail.props['aria-label'], /Not checked since the last failure/)
    assert.match(rail.props['aria-label'], /An update is running/)
  })
})

describe('row detail panes', () => {
  it('renders release notes and output as two panes in one grid', ZOD_REQUIRED, () => {
    const RowDetails = loadBundle().exports.get('dsh-plugin-updater').RowDetails
    const tree = RowDetails({
      row: {
        name: 'dsh-kanban',
        notes: { available: true, items: [{ commit: 'abc1234', subject: 'Fix the thing' }] },
        output: { text: 'pnpm output', truncated: false },
      },
    })
    assert.equal(tree.props.className, 'updater-details')
    const grid = tree.children[0]
    assert.equal(grid.props.className, 'updater-detail-grid')
    assert.equal(grid.children.length, 2)
    assert.equal(grid.children[0].props.className, 'updater-detail')
    assert.equal(grid.children[1].props.className, 'updater-detail')
  })

  it('lays the two panes side by side above a container breakpoint', ZOD_REQUIRED, () => {
    const FooterEntry = loadBundle().exports.get('dsh-plugin-updater').FooterEntry
    const tree = FooterEntry({
      wide: false,
      store: store({ total: 0, current: true, rows: [], checking: false, updating: false, busy: false }),
      openPanel: () => {},
    })
    const css = tree.children[0].type().children[0]
    assert.equal(typeof css, 'string')
    assert.match(css, /\.updater-details \{ container-type: inline-size; \}/)
    assert.match(css, /@container \(min-width: 560px\) \{ \.updater-detail-grid \{ grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\); \} \}/)
    assert.match(css, /\.updater-detail:only-child \{ grid-column: 1 \/ -1; \}/)
  })
})

/**
 * A React stand-in whose `useState` keeps values across renders, so a component
 * can be clicked and rendered again.
 * @returns {object} The harness.
 */
function stateful() {
  const state = []
  let index = 0
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'Fragment',
    useState(initial) {
      const at = index
      index += 1
      if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial
      return [state[at], (next) => {
        state[at] = typeof next === 'function' ? next(state[at]) : next
      }]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
  }
  return {
    React,
    /**
     * Render a component with a fresh hook cursor.
     * @param {Function} component The component.
     * @param {object} props Its props.
     * @returns {object} The element.
     */
    render(component, props) {
      index = 0
      return component(props)
    },
  }
}

describe('detail panes toggle independently', () => {
  const ROW = {
    name: 'dsh-kanban',
    notes: { available: true, items: [{ commit: 'abc1234', subject: 'Fix the thing' }] },
    output: { text: 'pnpm output', truncated: false },
  }

  /**
   * The two panes of one render, each with its toggle and optional body.
   * @param {object} harness The stateful harness.
   * @param {object} row The row.
   * @returns {object[]} The panes.
   */
  function panes(harness, row) {
    return harness.render(loadBundle({ React: harness.React }).exports.get('dsh-plugin-updater').RowDetails, { row }).children[0].children
  }

  /**
   * The rendered children of one pane, ignoring the collapsed `null`.
   * @param {object} pane The pane element.
   * @returns {object[]} Its children.
   */
  function body(pane) {
    return pane.children.filter((child) => child !== null && child !== undefined)
  }

  it('opens one without the other and then keeps both open', ZOD_REQUIRED, () => {
    const harness = stateful()
    const initial = panes(harness, ROW)
    assert.equal(initial.length, 2)
    assert.equal(body(initial[0]).length, 1)
    assert.equal(body(initial[1]).length, 1)

    body(initial[0])[0].props.onClick()
    const notesOpen = panes(harness, ROW)
    assert.equal(body(notesOpen[0]).length, 2)
    assert.equal(body(notesOpen[1]).length, 1)

    body(notesOpen[1])[0].props.onClick()
    const bothOpen = panes(harness, ROW)
    assert.equal(body(bothOpen[0]).length, 2)
    assert.equal(body(bothOpen[1]).length, 2)

    body(bothOpen[0])[0].props.onClick()
    const onlyOutput = panes(harness, ROW)
    assert.equal(body(onlyOutput[0]).length, 1)
    assert.equal(body(onlyOutput[1]).length, 2)
  })
})

describe('the failed-recovery row', () => {
  /**
   * Every string rendered by a tree, in order.
   * @param {object} tree The element.
   * @returns {string[]} The strings.
   */
  function strings(tree) {
    const out = []
    const walk = (node) => {
      if (typeof node === 'string') { out.push(node); return }
      if (node === null || node === undefined || typeof node !== 'object') return
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
    return out
  }

  it('does not claim the plugin was left in place when the reinstall failed', ZOD_REQUIRED, () => {
    const RowBody = loadBundle().exports.get('dsh-plugin-updater').RowBody
    const tree = RowBody({
      row: {
        name: 'dsh-kanban',
        kind: 'git',
        state: 'failed',
        failure: {
          code: 'operation-error',
          diagnostic: 'target failed',
          restored: false,
          recovery: { code: 'operation-error', diagnostic: 'rollback failed' },
          reason: 'could not restore dsh-kanban; reinstall github:filipeesch/x#abc to recover',
        },
      },
      store: { actions: {} },
    })
    const rendered = strings(tree)
    assert.equal(rendered.includes('The installed version was left in place.'), false)
    assert.equal(rendered.includes('could not restore dsh-kanban; reinstall github:filipeesch/x#abc to recover'), true)
  })

  it('still says the version was left in place when nothing was removed', ZOD_REQUIRED, () => {
    const RowBody = loadBundle().exports.get('dsh-plugin-updater').RowBody
    const tree = RowBody({
      row: {
        name: 'dsh-subscriptions',
        kind: 'registry',
        state: 'failed',
        failure: { code: 'operation-error', diagnostic: 'refused', restored: false },
      },
      store: { actions: {} },
    })
    assert.equal(strings(tree).includes('The installed version was left in place.'), true)
  })
})
