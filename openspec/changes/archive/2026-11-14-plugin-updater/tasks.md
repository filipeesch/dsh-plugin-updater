# Tasks

## 1. Package skeleton

- [x] 1.1 Write `package.json` with `private: true`, `engines.dsh` `>=0.2.2-rc.1 <0.3.0-0`, `dsh.bundle.patch`, `dsh.client.platform: web`, and exports for `.`, `./client`, `./locale/*.json`, `./icon`, `./package.json`; verify with `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` and by confirming `files` lists every runtime path that exists.
- [x] 1.2 Write `cordis.patch.yml` inserting one row named after the package; verify the YAML parses with the host's `yaml` package.
- [x] 1.3 Write `locale/en.json` with every user-facing string, including `meta.title` and `meta.description`; verify it parses and that no key used in code is missing (covered again by 6.5).
- [x] 1.4 Add `LICENSE` (MIT) and `README.md` in English stating installation is by GitHub only because the npm name is taken; verify the README names the exact install spec.

## 2. Pure logic and its tests

- [x] 2.1 Implement version comparison helpers (semver compare, commit-count formatting, `9+` clamping) in `src/version.js`; verify `npm test` passes the corresponding cases in `test/version.test.js`.
- [x] 2.2 Implement spec parsing that extracts the source kind and repository from a saved dependency spec without consulting the registry, in `src/spec.js`; verify tests cover a registry spec, a `github:owner/repo` spec, a spec with a pinned commit, a `file:` path, and one where the repository name differs from the package name.
- [x] 2.3 Implement candidate selection (direct dependency + declares `dsh.bundle` + not installation-provided), in `src/candidates.js`; verify tests cover a bundle, a plain dependency, a transitive package, and an installation-provided name.
- [x] 2.4 Implement display-identity selection: version change versus commit count when the version is unchanged, in `src/display.js`; verify tests cover both branches.
- [x] 2.5 Implement the `allowBuilds` key extractor over package manager output, rejecting wildcard and credential-bearing keys, in `src/build-approval.js`; verify tests cover the ignored-scripts form, the git-prepare form, a wildcard, and a key containing a credential.
- [x] 2.6 Implement ignore matching keyed by commit for git and by version for registry, in `src/ignore.js`; verify tests cover an ignored commit, a new commit with the ignored version, an ignored version, and a newer version after an ignored one.
- [x] 2.7 Implement trusted-repository matching by `host/path`, rejecting patterns and account-level entries, in `src/trust.js`; verify tests cover an exact match, a different repository of the same owner, and a rejected wildcard.
- [x] 2.8 Run `node --check` on every file under `src/` and `npm test`; verify both pass with no network access.

## 3. Host side

- [x] 3.1 Implement profile reading (dependency specs, lockfile commits, workspace settings) in `src/profile.js`; verify against the reference profile that each git candidate yields its installed commit and each registry candidate yields its saved range.
- [x] 3.2 Implement registry detection delegating to `pluginManager.listVersions`, in `src/detect-registry.js`; verify a candidate already at the newest version reports no update and one with a newer version reports the target.
- [x] 3.3 Implement git detection using `git ls-remote` plus the `package.json` at HEAD, in `src/detect-git.js`; verify an up-to-date candidate reports none, a moved HEAD reports an update, an unchanged version reports a commit count, and an unreachable repository reports a not-checked outcome without failing the others.
- [x] 3.4 Implement the blobless clone cache with a 100 MB bound and least-recently-used eviction in `src/clone-cache.js`; verify it fetches a repository, reuses it on a second call, and evicts when the bound would be exceeded.
- [x] 3.5 Implement release-note extraction (`git log installed..HEAD`) in `src/notes.js`; verify it returns commit identifier and subject for a range and reports unavailability when the clone fails.
- [x] 3.6 Implement the git update sequence (remove, install pinned, unfix the spec, restore on failure and on cancellation) in `src/update-git.js`; verify with a stub package manager that a successful run leaves the manifest unfixed, a failed run leaves the manifest as it was and the previous commit installed, and a cancellation after removal restores.
- [x] 3.7 Implement the batch runner: sequential, continues after failure, local reload last, cancellable with queue abandonment; verify with stubs that one failure does not stop the rest and that cancelling starts nothing further.
- [x] 3.8 Implement the local-plugin reload path with mtime-versus-Host-start comparison, in `src/update-local.js`; verify a plugin with a newer file offers reload and one without does not.
- [x] 3.9 Implement automatic build approval for trusted repositories, including retry and disclosure, in `src/approve.js`; verify a trusted repository adds the exact key and retries while an untrusted one produces an approval request and restores.
- [x] 3.10 Implement detection scheduling (startup, 60-minute interval, coalescing, manual refresh) and the failure-state model in `src/schedule.js`; verify concurrent requests start one cycle and a failed cycle marks results not current while keeping prior counts.

## 4. Host-to-Client bridge

- [x] 4.1 Define the Host-to-Client bridge with `createTypertContribution`, covering detection, single update, batch update, cancel, reload, settings read, and settings write; verify the descriptor list is well formed by loading the module in Node.
- [x] 4.2 Register the host face and expose the operations, re-emitting progress for the client; verify the host plugin applies in a stub context and the contribution registers.
- [x] 4.3 Confirm that every operation rejects an unauthorised or malformed request with a stated reason rather than throwing an unhandled error; verify with tests for a missing candidate and a malformed settings payload.

## 5. Client side

> **Status.** The components in 5.2-5.10 are written and their pure logic is unit-tested
> (279 tests, run in the checkout and inside a real profile). The "verify" half of each
> task needs a running interface and has **not** been performed: no rendering was
> observed, in either theme, expanded or collapsed. 5.1, 5.11 and 5.12 are ticked
> because each states a property that a test or a static check establishes.

- [x] 5.1 Read the sidebar footer slot contract and register one `sidebar.footer.action` entry; verify the entry appears above Settings in the expanded sidebar and that no `sidebar.panellist` entry is registered.
- [ ] 5.2 Build the expanded footer row: icon, label, right-aligned count, refresh control, with the icon and label opening the panel and the refresh control starting detection without opening it; verify each of the three activations does what the spec says.
- [ ] 5.3 Build the collapsed-row rendering as an icon with a corner badge clamped at `9+`, omitting the label, the numeric text, and the refresh control; verify in the collapsed sidebar.
- [ ] 5.4 Register the main panel and open it from the footer row; verify the panel opens and that the sidebar selection state is consistent after closing it.
- [ ] 5.5 Build the pending-work tab: rows for updates, reloads, and failed checks, each with the action that applies; verify all three row kinds render with their correct action.
- [ ] 5.6 Build the per-row release-notes disclosure with scrolling for long lists and an explicit message when notes are unavailable; verify a long list scrolls inside the row and an unavailable case states why.
- [ ] 5.7 Build row action states (idle, running with step, completed, failed with output revealed) and the batch action present whenever at least one candidate is pending; verify each state renders and that a single pending candidate still shows the batch action.
- [ ] 5.8 Build the settings tab: trusted repository list editing, ignored update review and clearing, and cache usage display; verify each control writes through the bridge and the value persists after a reload.
- [ ] 5.9 Build the restart notice that persists in the panel until the Host restarts; verify it appears only when the host reports a restart requirement and disappears after a restart.
- [ ] 5.10 Build the batch completion summary and the out-of-panel notice, counting per outcome with a route to the detail; verify a mixed batch produces the three counts and a fully successful one does not offer a failure route.
- [x] 5.11 Localise every user-facing string through the client locale service and verify no literal string remains in components.
- [x] 5.12 Style with host theme tokens only, renaming any copied class under a plugin prefix; verify by inspection that no literal color, no import of a host client package, and no `document.body` write exists.

## 6. Integration and verification

- [ ] 6.1 Verify the first-use trusted-repository proposal presents the repositories of installed git plugins and trusts nothing until confirmed, including that a removed entry is not trusted.
- [ ] 6.2 Verify a full update of a real git candidate: detection finds it, the update installs the new commit, the spec returns to unfixed form, and a subsequent detection still follows HEAD.
- [ ] 6.3 Verify a forced failure restores the previous commit and leaves the saved spec byte-identical to what it was before the attempt.
- [ ] 6.4 Verify the restart requirement appears only for an update the host reports as restart-requiring.
- [x] 6.5 Cross-check every locale key used in code against `locale/en.json` and report any key with no entry.
- [ ] 6.6 Verify the collapsed and expanded sidebar renderings, light and dark themes, and report explicitly which visual checks were performed and which remain unverified without a running interface.
- [ ] 6.7 Draw three icon candidates at 16 px and 18 px in both themes, present them, and record which one was chosen.
