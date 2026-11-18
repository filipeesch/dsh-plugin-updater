# Proposal

## Why

A failed registry update currently reports only a placeholder — "the host reported a failed update" — while the Host's own error code, diagnostic, and package-manager output are discarded on the way to the row. The same surface stacks release notes and package-manager output in two sibling blocks that both expand inside the row and push the list down, and it prints a "Build script approved" line for every candidate that needed approval, which is log noise on a row that already says "Updated". The git update path also removes the installed package first in every case, even where the Host can install the new commit over the running one.

The user can update the same package successfully from the DSH Plugins page, which passes the registry that answered the version listing to `updateBundle`, while this plugin passes none. That call-shape difference is the leading explanation for the registry failure and is cheap to align.

## What Changes

- Report the Host's failure code and diagnostic on the row instead of the placeholder, keep the package-manager output available, and offer a **copy details** action that copies package, version or commit, code, diagnostic, and the output tail.
- Pass the registry that answered detection to `updateBundle`, matching the DSH Plugins page, so the update and the listing use the same registry plan.
- Stop offering a registry update whose newest version is incompatible with the running DSH: report that no compatible version exists and say why, instead of an update action that the Host refuses.
- Present release notes and package-manager output side by side when both exist, stacking below a container breakpoint, each still collapsed until asked for.
- Remove the completed "Build script approved" line, and remove the approved keys from the snapshot result, the client schema, the store, and the tests. **BREAKING**: the plugin's own wire drops `approved`.
- For a git candidate, attempt the pinned install over the running package first and fall back to remove-then-install only when the Host refuses with `already-installed`; other failures leave the installed package untouched.
- Leave the behaviour that must not change intact: restoration of the previous commit after a removal, the saved dependency spec returning to its unfixed form, batch ordering, cancellation, restart reporting, and trust rules.

## Capabilities

### New Capabilities

None. The behaviour lands in capabilities this plugin already declares.

### Modified Capabilities

- `plugin-update-application`: registry updates carry the answering registry; git updates try installing over before removing; failure reporting carries the Host's code and diagnostic instead of a placeholder.
- `plugin-update-detection`: a registry candidate with no version compatible with the running DSH is not offered as an update.
- `plugin-updates-panel`: row detail presents notes and output side by side with a stacked fallback; a failed row shows the diagnosis and offers copy details; an incompatible candidate gets an informative row without an update action.
- `plugin-build-approval`: approval stops being row content — the completed row no longer displays approved keys, and no approved-key field travels to the browser.

## Impact

- Browser half: `client.js` (row and row-detail components, status and failure formatting, store split), `locale/en.json`.
- Host half: `src/apply.js`, `src/host.js`, `src/detect.js`, `src/display.js`, `src/remote.js`, `src/strings.js`.
- Wire: the snapshot result and the Remote result codecs change shape (`approved` removed, failure detail surfaces). `test/remote-parity.test.js` guards the two copies.
- Tests: apply, detection, client model, client store, render, strings, and remote parity suites.
- No change to any DSH package, no new dependency, no build step. Plugin version moves to 0.3.0 because its own wire changes.
- The cause of the reported `dsh-subscriptions` 0.3.7 failure is confirmed by a manual retry on the panel once the diagnosis is visible; the finding is recorded with the change.
