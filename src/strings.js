/**
 * The English strings, in the shape the client binds.
 *
 * `locale/en.json` is the file the host reads for the bundle's display metadata;
 * this module is what the components interpolate. A test asserts the two agree,
 * so a key added to one cannot silently go missing from the other.
 * @module dsh-plugin-updater/strings
 */

export const en = {
  'entry.label': 'Plugin Updater',
  'entry.countAria': '{{count}} plugins need attention',
  'entry.refresh': 'Check for plugin updates',
  'entry.checkFailed': 'A plugin could not be checked',
  'entry.notCurrent': 'Not checked since the last failure',

  'tabs.updates': 'Updates',
  'tabs.settings': 'Settings',

  'list.allCurrent': 'Everything is up to date.',
  'list.lastChecked': 'Last checked at {{time}}',
  'list.unknown': 'No successful check yet.',
  'list.checking': 'Checking…',
  'list.retry': 'Check again',
  'list.ignoredTitle': 'Ignored updates',
  'list.ignoredCount': '{{count}} ignored',

  'row.update': 'Update',
  'row.reload': 'Reload',
  'row.retry': 'Try again',
  'row.showNotes': 'Show changes',
  'row.hideNotes': 'Hide changes',
  'row.notesNone': 'No changes were found.',
  'row.notesUnavailable': 'Changes could not be loaded: {{reason}}',
  'row.showOutput': 'Show output',
  'row.hideOutput': 'Hide output',
  'row.sourceRegistry': 'npm',
  'row.sourceGit': 'GitHub',
  'row.sourceLocal': 'Local',
  'row.notChecked': 'Not checked',
  'row.ignore': 'Ignore',
  'row.specRestoreFailed': 'The saved version could not be reset, so this plugin may stop reporting updates: {{reason}}',

  'phase.running': 'Working',
  'phase.updated': 'Updated',
  'phase.reloaded': 'Reloaded',
  'phase.failed': 'Failed',
  'phase.cancelled': 'Cancelled',
  'phase.restored': 'Restored',
  'phase.needsApproval': 'Needs approval',
  'phase.approved': 'Build script approved',

  'restart.required': 'Restart DeepSeek Harness to load the updated plugins.',

  'summary.updated': '{{count}} updated',
  'summary.reloaded': '{{count}} reloaded',
  'summary.needsApproval': '{{count}} needs approval',
  'summary.failed': '{{count}} failed',
  'summary.restored': '{{count}} restored',
  'summary.skippedIgnored': '{{count}} ignored skipped',
  'summary.specRestoreFailed': '{{count}} plugin(s) may stop reporting updates because the saved version could not be reset',
  'summary.viewDetails': 'View details',

  'actions.updateAll': 'Update all',
  'actions.cancel': 'Cancel',

  'settings.trustedTitle': 'Trusted repositories',
  'settings.trustedDescription': 'Build scripts are approved automatically only for these repositories. Every other repository asks first.',
  'settings.trustedEmpty': 'No trusted repositories. Every build script asks first.',
  'settings.trustedAdd': 'Add repository',
  'settings.trustedPlaceholder': 'github.com/owner/repo',
  'settings.trustedInvalid': 'Enter one repository as owner/repo or host/owner/repo. Trust is per repository, not per account.',
  'settings.remove': 'Remove',
  'settings.ignoredTitle': 'Ignored updates',
  'settings.ignoredEmpty': 'No ignored updates.',
  'settings.ignoredClear': 'Stop ignoring',
  'settings.cacheTitle': 'Change cache',
  'settings.cacheUsage': '{{used}} of {{limit}} used by {{count}} repositories.',
  'settings.cacheClear': 'Clear cache',

  'onboarding.title': 'Trust your plugin repositories',
  'onboarding.body': 'Approving a build script runs code from that repository. Trust only the repositories you installed on purpose. Nothing is trusted until you confirm.',
  'onboarding.confirm': 'Trust these repositories',
  'onboarding.later': 'Decide later',

  'error.generic': 'Something went wrong: {{reason}}',
}

export default en
