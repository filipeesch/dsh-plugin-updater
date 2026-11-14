/**
 * Which installed packages are update candidates.
 *
 * The rule is the host's own: a package is a bundle when its manifest declares
 * `dsh.bundle`. Restricting candidates to direct profile dependencies keeps
 * transitive packages out, and a bundle the installation itself supplies is not
 * the profile's to update: the host reports that as
 * `BundleInfo.availability === 'installation'`, and replacing it would change
 * code that ships with the application.
 * @module dsh-plugin-updater/candidates
 */

/**
 * Build the candidate list from already-read inputs.
 *
 * Pure so the rule can be tested without a profile. Reading the profile and its
 * manifests happens in `profile.js`.
 * @param {{
 *   dependencies?: Record<string, unknown>,
 *   declaresBundle: (name: string) => boolean,
 *   installationProvides?: (name: string) => boolean
 * }} input Profile facts.
 * @returns {string[]} Candidate names in profile order.
 */
export function selectCandidates(input) {
  const dependencies = input.dependencies ?? {}
  const provides = input.installationProvides ?? (() => false)
  const chosen = []
  for (const name of Object.keys(dependencies)) {
    if (provides(name)) continue
    if (!input.declaresBundle(name)) continue
    chosen.push(name)
  }
  return chosen
}

/**
 * Why a name was not offered as a candidate, for diagnostics.
 * @param {{
 *   name: string,
 *   dependencies?: Record<string, unknown>,
 *   declaresBundle: (name: string) => boolean,
 *   installationProvides?: (name: string) => boolean
 * }} input Profile facts for one name.
 * @returns {'candidate'|'not-a-dependency'|'no-bundle'|'installation-provided'}
 *   The reason.
 */
export function classifyCandidate(input) {
  const dependencies = input.dependencies ?? {}
  if (!Object.hasOwn(dependencies, input.name)) return 'not-a-dependency'
  if ((input.installationProvides ?? (() => false))(input.name)) return 'installation-provided'
  if (!input.declaresBundle(input.name)) return 'no-bundle'
  return 'candidate'
}
