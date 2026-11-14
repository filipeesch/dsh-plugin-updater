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
