# Tasks

## 1. Host: progress and run visibility

- [x] 1.1 Thread a per-attempt request id through `updateGit`, its restore path, and `updateRegistry`; verify `test/apply.test.js` asserts the id reaches each `installBundle` and `updateBundle` call.
- [x] 1.2 Add a `run` record to `UpdaterService` (started time, current name/step/request id, per-item results) for single updates and batches; verify new host tests cover a single run and a two-item batch.
- [x] 1.3 Expose `run` in the snapshot and add it to the `Snapshot` schema; verify `test/remote-parity.test.js` asserts the `run` and `approvals` fields and the absence of `proposedRepositories`.
- [x] 1.4 Add `whenIdle()` to `CheckScheduler`; verify a test shows it resolves after a running cycle and immediately when idle.
- [x] 1.5 Implement `recheck({ name })`: wait for a running detection, re-read bundles, run the check for one candidate, merge its result, recompute the total; verify tests for success, repeated failure, untouched neighbours, and a concurrent detection.

## 2. Host: trust and build approval

- [x] 2.1 Implement `trustRepository({ name })`: resolve the saved git spec, normalise it with `src/trust.js`, write through `configEditor`, return the snapshot; verify tests reject a non-git or unknown candidate and add exactly one identity.
- [x] 2.2 Retain a pending approval record (`repository`, target commit, keys) when a git attempt returns `needsApproval`, expose `approvals` in the snapshot, and drop it only when the plugin disappears; verify tests for retention after a moved HEAD and removal.
- [x] 2.3 Implement `decideBuild({ name, decision })` for `allow`, `always-allow`, and `decline`, replaying only host-held keys; verify allow installs the retained target, always-allow also trusts the repository, decline writes nothing, and no client-supplied key is accepted.
- [x] 2.4 Remove `proposeRepositories` and the `proposedRepositories` snapshot field; verify `test/onboarding.test.js` is replaced by per-row trust coverage and no snapshot assertion expects the field.
- [x] 2.5 Extend the wire face in `src/remote.js` with `recheck`, `trustRepository`, and `decideBuild`, the new snapshot fields, and the removed field; verify the descriptor tests report the new method count and schemas.

## 3. Client: internal modules and pure model

- [x] 3.1 Restructure `client.js` into explicit internal sections (copy, format, model, store, components, apply) with dependencies passed as arguments, keeping the registered id, exports, and slot registrations intact; verify `test/client-bundle.test.js` still loads the bundle and sees the same three slots.
- [x] 3.2 Implement the pure `format` module (source chip, version/commit text, step and outcome labels, status tone, clock time); verify focused tests for each label and tone.
- [x] 3.3 Implement the pure `model` module (rows merged from base and session, header summary, toolbar state, notice, dismissed filtering, approval merge); verify tests cover a running row, a settled row absent from the base, dismissal, and a pending approval.
- [x] 3.4 Implement `createStore({ remote, layout, translate, now, schedule })` and export it from the bundle; verify a fake remote records `snapshot`, `refresh`, `updateOne`, `updateAll`, `cancel`, `saveConfig`, `clearCache`, `recheck`, `trustRepository`, and `decideBuild` calls.
- [x] 3.5 Keep `rowsFromSnapshot` and `summaryNoticeOf` exported and adapt their signatures to the new model; verify the existing pinned-spec tests still pass.

## 4. Client: feedback behavior

- [x] 4.1 Subscribe to `plugin-manager/changed`, `update-state`, `install-state`, and `install-log`; verify a test proves `changed` calls `snapshot` (not `refresh`), is debounced, and that steps and logs reach the owning attempt.
- [x] 4.2 Poll the snapshot only while `run` exists and stop on settle; verify fake-timer tests for start, per-item update, and stop.
- [x] 4.3 Implement the single-update and batch attempt lifecycle, including queued/running/settled outcomes and per-item results from the run record; verify tests for success, failure, and a mixed batch.
- [x] 4.4 Implement settled-row retention, per-row dismissal, and clearing on a manual check only; verify tests show an automatic check keeps the row and a manual check removes it.
- [x] 4.5 Implement the completion notice for single updates and batches, including while the panel is closed and with a restart requirement; verify tests assert the notice text, tone, and retained restart line.
- [x] 4.6 Implement the trust, re-check, and approval actions; verify tests show the trust action calls the host with the name only, retry calls `recheck`, each decision sends only the name and decision, and an allowed approval settles its row.
- [x] 4.7 Implement busy/error handling so a failed call surfaces once and does not clear existing rows; verify tests for a rejected snapshot and a rejected update.

## 5. Client: panel, settings, and sidebar

- [x] 5.1 Build the panel page shell and header (title, pending summary, last-check line, failed-check marker) with host spacing and typography; verify the rendered panel in the review screenshots and no literal color in the new styles.
- [x] 5.2 Replace the corner tab buttons with the segmented control, including `tablist`/`tab`/`tabpanel`, roving tab stop, and arrow/Home/End handling; verify keyboard navigation and screen-reader selection in review.
- [x] 5.3 Build the sticky toolbar with the pending summary, "Check now", "Update all", and the cancel state; verify it stays visible while the list scrolls and disables correctly while a run is active.
- [x] 5.4 Build the flat list row with source chip, version/commit, toned status badge, action, dismiss, trust action, and the collapsed notes/output/failure expansions; verify each expansion opens and the failure output opens by itself.
- [x] 5.5 Build the inline approval card with the exact entries and the three actions; verify it renders from the snapshot after a failed attempt and each action reaches the host.
- [x] 5.6 Build the Settings tab as grouped cards (trusted repositories, ignored updates, cache) with the same layout, empty states, and validation; verify add/remove, unignore, and clear-cache still work.
- [x] 5.7 Rebuild the sidebar entry with the upward-arrow glyph, right-aligned count, failure dot with accessible name, checking/update indicator, and the collapsed badge; verify both sidebar widths in review.
- [x] 5.8 Replace the toast with the host-style banner (top-center, toast tokens, `role="alert"`, hold/fade, success glyph, action, restart line); verify success and failure notices in both themes.
- [x] 5.9 Correct the theme tokens, focus rings, hover guards, and reduced-motion handling across all new styles; verify no literal color or non-existent token remains in `client.js`.
- [x] 5.10 Add the visually hidden live region for step and outcome announcements and accessible names for row actions, tabs, the failure dot, and the refresh control; verify the announcements in review.

## 6. Copy, contract, and documentation

- [x] 6.1 Add the new English copy to `locale/en.json`, `src/strings.js`, and the inline bundle dictionary, and remove the onboarding keys; verify `test/strings.test.js` passes with the new keys.
- [x] 6.2 Prune or wire the unused locale keys exposed by the progress and approval work; verify no unused key remains in the dictionary or the test exempts it deliberately.
- [x] 6.3 Add a parity test between the bundle's wire face and `src/remote.js` (method names, request schemas, result codecs); verify it fails when a method or field is changed on only one side.
- [x] 6.4 Update `README.md` and `INSTALL-CHECKLIST.md` for the new panel, per-row trust, progress, approval, and opening behavior, and bump the package version to 0.2.0; verify the documented commands still match `package.json`.
- [x] 6.5 Run `npm run check` and `npm test` and confirm every suite passes, including the skip-aware bundle tests.

## 7. Review and visual validation

  - Component-harness prints are already in `.ui-review/updater-ui/shots/` (light and dark). The live link below remains for the review step.
- [ ] 7.1 Link the worktree into the web profile, open the panel, and capture light/dark screenshots of the entry, updates tab, running row with expanded log, settled row, approval card, and settings tab; verify against the design decisions. (Authorized by the user for the review step; revert afterwards.)
- [ ] 7.2 Walk the spec scenarios against the running panel and record any mismatch as a fix task before closing the change.
- [ ] 7.3 Restore the profile link and confirm the previously installed plugin version is back; verify `git status` in the worktree is clean apart from the intended change.