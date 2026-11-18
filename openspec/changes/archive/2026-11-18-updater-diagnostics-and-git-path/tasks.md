# Tasks

## 1. Baseline

- [x] 1.1 Run the existing suite from the repository root with `npm test` and confirm it passes before any edit, so later failures are attributable to this change
- [x] 1.2 Read `src/apply.js`, `src/detect.js`, `src/host.js`, and the row/store sections of `client.js` and confirm the seams named in `design.md` still match the code; record any drift before editing

## 2. Failure diagnosis on the Host

- [x] 2.1 Add `src/diagnosis.js` exporting a pure `describeFailure(result)` returning `{ code, diagnostic, output, restored }` for the registry, git, and restore shapes, and verify it with unit tests covering each shape, a missing output, and a missing diagnostic
- [x] 2.2 Replace the placeholder reason in `updateRegistry` and the git failure paths with the described failure, and verify the existing apply tests still pass with the new reason shape
- [x] 2.3 Carry the described failure into the run record and the settled result in `runItem`, and verify a host test asserts the run result exposes the code and diagnostic

## 3. Registry call parity and detection filters

- [x] 3.1 Carry the answering registry from the version listing into the candidate identity in `src/detect.js`, and verify a detect test asserts `identity.registry` for a listed version
- [x] 3.2 Pass that registry to `updateBundle(name, version, { registry, requestId })` in `runItem`, and verify a host test asserts the call receives the registry carried by the candidate
- [x] 3.3 Change `checkRegistry` to select the newest version with `bundle === true` and no `incompatible`, and verify tests for: compatible newest wins, a newer version without a bundle is skipped, and every newer version incompatible reports blocked with a reason
- [x] 3.4 Thread the blocked state through `host.js` and the snapshot so the client can render it, and verify a snapshot test shows the blocked candidate with its reason

## 4. Git install-over path

- [x] 4.1 Change `updateGit` to attempt `installBundle(pinnedSpec, { saveExact: true, enabled: true, requestId })` before any removal, and verify an apply test asserts no `removeBundle` call on success
- [x] 4.2 Fall back to remove-then-install only when the settled result carries `error.code === 'already-installed'`, and verify an apply test for the fallback plus one for a non-`already-installed` failure that never removes
- [x] 4.3 Keep the approval replay ahead of any removal so an approval retries the install-over attempt with `approvedBuilds`, and verify a test for blocked-builds-then-approve without a `removeBundle` call
- [x] 4.4 Keep the saved-spec restore and the restore-after-removal path unchanged, and verify the existing restoration and spec-reset tests pass

## 5. Approval noise removal

- [x] 5.1 Drop `approved` from the update result in `apply.js`, from the snapshot in `host.js`, and from `src/remote.js`, and log one line per approval naming the repository and entries; verify a host test asserts the field is absent and the log call happened
- [x] 5.2 Remove the approved line, the `approved` schema field, and the store plumbing in `client.js`, and verify `test/remote-parity.test.js` and `test/client-bundle.test.js` pass with both wire copies in sync
- [x] 5.3 Delete the now-unused strings for the approved label from `src/strings.js`, `locale/en.json`, and the client copy, and verify `test/strings.test.js` passes

## 6. Row detail layout and copy details

- [x] 6.1 Extract `RowHead`, `RowStatus`, `RowDetails`, and `CopyDiagnosis` from `Row`, and verify `test/client-render.test.js` still covers the collapsed footer and the row composition
- [x] 6.2 Render notes and output as two panes in one wrapper with `container-type: inline-size`, stacked by default and side by side above the breakpoint, each with its own collapse state; verify a render or model test covers both panes being open together
- [x] 6.3 Render the Host's code and diagnostic as the row reason and keep the output available, and verify a model test asserts no placeholder text when a diagnostic exists
- [x] 6.4 Add the pure `diagnosisText(row)` formatter and a store `copy(name)` action using an injected clipboard, with a transient confirmation; verify tests for content with output, content without output, and the confirmation without focus change
- [x] 6.5 Render the blocked candidate as a non-actionable row with its reason, and verify it is excluded from the pending count and the header summary and that it returns to an actionable update when a compatible version appears

## 7. Store decomposition

- [x] 7.1 Extract `createAttempts` (attempts, request-id mapping, log buffer/coalescing, settle, dismissal) behind injected dependencies, and verify the moved store tests pass without changes to their assertions
- [x] 7.2 Extract `createNotices` (single and batch notices, hold, dismissal), and verify the notice tests pass through the new seam
- [x] 7.3 Extract `createPoller` (poll while running, manager subscriptions, debounce into a snapshot read), and verify the polling and event tests pass through the new seam
- [x] 7.4 Extract `createActions` over the collaborators, keeping the store's public `getSnapshot`, `subscribe`, and `actions` shape, and verify the full client test suite passes unchanged

## 8. Release and verification

- [x] 8.1 Bump the package version to 0.3.0 and update `README.md` and `INSTALL-CHECKLIST.md` where they describe failure reporting, the approved line, or the update path; verify the docs no longer promise the removed behaviour
- [x] 8.2 Run `npm test` and `npm run check` from the repository root and verify both pass
- [ ] 8.3 After the diagnosis is visible, update `dsh-subscriptions` from the panel once, capture the failure code and diagnostic, and record the finding in this change; verify the recorded cause matches what the row showed
- [x] 8.4 Run `openspec validate updater-diagnostics-and-git-path --strict` and verify it passes before handing the change to review