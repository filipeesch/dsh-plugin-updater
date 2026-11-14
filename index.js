/**
 * The Host half of Plugin Updater.
 *
 * One host row: it reads the profile, checks for updates on a schedule, and
 * applies updates through the host's own plugin manager. The panel talks to it
 * over a hand-written bridge in `client.js`, whose descriptor face is registered
 * here because this entry is the one that can resolve `zod` from the profile.
 */
import { apply as mount } from './src/host.js'
import { host as hostFace, SERVICE_NAME } from './src/remote.js'

/** Services the row needs before it runs. */
export const inject = ['pluginManager', 'profileContext', 'typert']

/**
 * Mount the plugin on a Host context.
 * @param {object} ctx Host plugin context.
 * @param {object} config Row configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  mount(ctx, config, { serviceKey: SERVICE_NAME, hostFace })
}
