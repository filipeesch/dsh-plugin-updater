# Design

See `proposal.md` for motivation and `specs/` for required behaviour. This document explains how the behaviour is produced.

## Context

The plugin ships plain ESM with no build step. Its Host half is `index.js` plus `src/*`; its browser half is a single registered factory in `client.js` because the module table resolves only the `react` and `zod` seeds and synchronous relative `require` is unsupported. The v0.2.0 design already split that file into internal factories — `createStore`, a pure model, and presentational components — and the tests exercise them through the module-table harness.

`createStore` is now about 780 lines: state layers, remote call wrapper, attempt tracking, log buffering and coalescing, polling, plugin-manager subscriptions, notice lifecycle, and twelve actions. `UpdaterService` is about 1,020 lines: detection, run record, approval record, restart bookkeeping, config, cache, re-check, trust, and decisions.

Two Host facts shape this change:

- `installBundle` refuses an install over a package the profile already depends on when the requested spec does not replace that dependency — the situation a Host executing the bundle is in — and reports the first-class `already-installed` code before pnpm starts. When the Host accepts the install it lands over the running package and reports `restart-required`; hot reload is not the only thing that decides either outcome.
- `updateBundle(name, version, options)` accepts `spec` for a git copy pinned to that copy's repository directory, and refuses it for a registry copy; a registry copy accepts `registry`, where `null` asks pnpm's own registry and an absent value asks the remembered or configured one. The DSH Plugins page passes the registry that answered its version listing, while this plugin passed none, so the update plan could start from a different registry than the listing did. `updateBundle` offers no way to replay approved build entries, which is why the approval path still calls `installBundle`.

Both failure paths surface a first-class `error.code` (for example `already-installed`, `incompatible-version`, `not-bundle`, `operation-error`) plus an optional `diagnostic`, and usually a `packageResult` with the package manager output. The current code keeps the output and discards the code and diagnostic.

The plugin's own wire is written twice on purpose — `src/remote.js` and the embedded face in `client.js` — and `test/remote-parity.test.js` compares method names, request schemas, and result codecs so the copies cannot drift silently.

## Goals / Non-Goals

**Goals:**

- Make a failed update explain itself with the Host's own words, without the browser having to understand Host payload shapes.
- Align the update call with the DSH Plugins page where that difference is observable.
- Let the Host decide whether a git commit can be installed over the running package, instead of this plugin always removing first.
- Keep the row layout a pure view concern, so the detail layout can change without touching the store.
- Reduce the two largest units of code into named collaborators with explicit dependencies, without changing the plugin's architecture or adding files to the browser bundle.

**Non-Goals:**

- Delegating git updates to `updateBundle`; the approval replay needs `installBundle(approvedBuilds)`, which `updateBundle` does not accept.
- Detecting HMR from the plugin. The Host's refusal is the signal.
- An override that forces an incompatible version. If every published version rejects the running DSH, the panel says so.
- Splitting `UpdaterService`; the host changes here are additive and local.
- Persisting diagnoses, blocked rows, or copy confirmations across a restart.
- Any change to a DSH package, the locale files beyond English, or the visual language of the panel.

## Decisions

### Failure diagnosis becomes one pure value produced on the Host

A new pure module `src/diagnosis.js` maps an update result into a single shape: `{ code, diagnostic, output: {text, truncated, exitCode}, restored, recovery? }`. `recovery` carries the diagnosis of a failed reinstallation, which is a different problem from the failed target, and the Host adds the outcome's own `reason` so the row can name the spec to reinstall. It reads the registry path (`result.result.error` and `result.result.restore`), the git path (`result.error` and `result.restore`), and the restore outcome, and it knows nothing about the browser.

**Why:** four places currently dig into those payloads — the approval decision, `trimOutput`, the client's attempt merge, and the row — and each reads a different subset. One mapping keeps the copy text, the row text, and the approval path consistent, and gives the client a stable contract to render.

**Alternatives rejected:** teaching the client about Host payload shapes (duplicates the mapping, and the client cannot import host code); leaving the reason strings in `apply.js` (they are where the placeholder lives today).

### The answering registry travels with the candidate

Detection already receives `registry` in the version listing. It is carried into the candidate identity as `identity.registry` — a string or an explicit `null`, both meaningful to the Host — and passed to `updateBundle(name, version, { registry, requestId })`.

**Why:** it is the only parameter that differs from the DSH Plugins page, and a mirror that answers a version list can still refuse a version-specific read. Passing it makes the update ask the same registry order the user saw.

**Alternatives rejected:** passing `registry` from the client (the client must not choose registries); falling back to the configured registry on refusal (would ask a registry the listing never mentioned).

### Detection offers only a bundle that is compatible

`checkRegistry` keeps the newest version whose `bundle` is true and whose `incompatible` is absent. When there is none, the candidate reports `state: 'blocked'` with a reason instead of `state: 'update'`.

**Why:** today the fallback offers `versions[0]` even when it is incompatible or declares no bundle, so the user sees an action the Host will always refuse. The existing spec already required the bundle filter; this closes both gaps in one place.

**Alternatives rejected:** offering the version marked as blocked (keeps an action that cannot work); hiding the candidate entirely (the user would never learn why the update disappeared).

### Git updates attempt install-over, and remove only on the Host's refusal

`updateGit` first calls `installBundle(pinnedSpec, { saveExact: true, enabled: true, requestId })`. Only when the settled result carries `error.code === 'already-installed'` does it remove and install again. Any other failure ends the attempt with a diagnosis and no removal.

**Why:** it implements "install over when the Host allows it" without asking the plugin to detect the cause, and a refused attempt costs one call that fails before pnpm runs. It also removes the assumption that removal is always necessary. The trigger is the reported code, not a guess about hot reload.

**Consequences:** the saved-spec restore and the restore-after-removal path stay exactly as they are, because they still only run after a removal. An install-over failure never needs the reinstall step, so its outcome says the previous state was untouched.

**Alternatives rejected:** querying `ctx.get('hmr')` (couples the plugin to a runtime service that may not be exposed); always removing (the current behaviour, and the item this change exists to validate).

### Build approval replay happens before any removal

If the install-over attempt reports blocked build scripts, the existing approval decision runs against that result, and an approval replays the install with `approvedBuilds` — still without removing. Only when the replayed install is itself refused with `already-installed` does the flow remove and retry.

**Why:** the previous version must not disappear just because a script needs a decision, which is the same invariant the v0.2.0 approval design established.

### Approved keys leave the wire; the approval stays in the Host log

`apply.js` stops returning `approved`, `host.js` stops copying it, the snapshot and run result lose the field, the client schema and store drop it, and the row drops the line. The Host logs one line per approval: repository, entries, and the candidate.

**Why:** the line is the noise the task names, and a field with no consumer in three layers is dead weight. The log keeps the audit trail for support.

**Alternatives rejected:** moving the line into the detail area (still row content the user did not ask for); keeping the field for a future UI (unused wire fields rot).

### The row's details are two panes in one container-query layout

`Row` is split into presentational pieces inside `client.js`: `RowHead` (identity, inline status badge, and the grouped action controls), `RowBody` (diagnosis, warnings, approval card), `RowDetails` (the two panes), and `CopyDiagnosis`. `RowDetails` renders the notes pane and the output pane inside a wrapper with `container-type: inline-size`; a container query above a threshold lays them out as two columns, and the default is stacked. Each pane keeps its own collapsed state.

**Why:** the current two sibling blocks each expand full-width and push the list down. A container query keys the layout to the panel column instead of the viewport, which is what the user sees when the panel is narrow. Splitting the component keeps the row from growing while it gains the diagnosis and copy controls.

**Alternatives rejected:** tabs (comparison needs both visible); a global width class (the panel width is not the viewport width); a drawer (extra navigation for content that belongs to the row).

### The store is decomposed into four collaborators

Inside `client.js`, `createStore` keeps the state layers, `publish`, and `adopt`, and composes:

- `createAttempts({ translate, onChange })` — session attempts, request-id mapping, streamed log buffer with coalescing and the host's 8,000-character cap, settle and dismissal.
- `createNotices({ translate, publish })` — notice construction for one candidate and for a batch plus dismissal; the hold timing stays in the React overlay that renders the toast, where the mount/unmount lifetime belongs.
- `createPoller({ remote, subscribe, load, isBusy, schedule })` — the snapshot poll while a run exists, the `plugin-manager/*` subscriptions, and the debounce that turns a manager change into a snapshot read.
- `createActions({ remote, store, attempts, notices, poller, copy, translate })` — the twelve user actions, each a thin composition of the others.

**Why:** each collaborator has one lifecycle and one reason to change, which is what makes the store testable without building the whole state machine. The browser bundle stays a single file; the modules are factories with injected dependencies, matching the pattern the v0.2.0 design established.

**Alternatives rejected:** leaving the store as one unit (the failure-diagnostics and copy features would add a fifth concern); splitting only the log buffer (leaves notice and polling lifecycles entangled).

### Copy details is a store action over a pure formatter

`diagnosisText(row)` is a pure function in the model: plugin name, installed and target identifiers, code, diagnostic, and the output tail when present. The store gains `copy(name)`, which builds that text, calls an injected `copy` dependency (`navigator.clipboard.writeText` by default), and shows a short confirmation through the existing toast.

**Why:** the text is data, so it is testable without a DOM; the clipboard is a side effect, so it is injectable and fakeable. Reusing the toast avoids a second transient surface and keeps focus where it was.

**Alternatives rejected:** a textarea plus `execCommand` (legacy); copying the raw result payload (noise and no context).

### Test strategy

- `src/diagnosis.js`: unit tests for each Host shape, including a result with no output and one with a restore.
- `src/apply.js`: install-over success, `already-installed` fallback, a non-`already-installed` failure that never removes, and the approval replay ordering.
- `src/detect.js`: newest compatible bundle wins; all-incompatible reports blocked; a newer version without a bundle is skipped.
- `client.js` model: `diagnosisText` (with and without output), rows for a blocked candidate, and the registry carried in the identity.
- `client.js` store: fakes for remote, copy, clock, and schedule — copy confirmation, failed-row diagnosis retention across `adopt`, and the four collaborators exercised through their own seams.
- `test/remote-parity.test.js` and `test/client-bundle.test.js`: the wire loses `approved` on both copies and still matches.
- No new dependency and no DOM test library.

## Risks / Trade-offs

- **Install-over costs one refused call under HMR** → the refusal happens before pnpm starts, so it is a single in-process call; the fallback path is unchanged.
- **A Host that stops reporting `already-installed` would break the fallback** → the code treats only that code as a fallback trigger; any other failure is reported, not silently retried. The parity test does not cover Host behaviour, so the apply test fakes the code explicitly.
- **Detection could hide an update the user wants** → the row states why no compatible version exists, and the non-goal records that forcing is out of scope.
- **Removing `approved` breaks the plugin's own wire** → the version moves to 0.3.0, both wire copies change together, and the parity test fails if one copy lags.
- **Copied output can include local paths** → the text is the pnpm tail the user already sees in the row; no credentials or approval keys are added.
- **Container queries on an older renderer** → the stacked layout is the default, so an unsupported query degrades to the readable case.
- **Store split risks behaviour drift** → the four collaborators are extracted with the existing tests moved first, and the store's public shape (`getSnapshot`, `subscribe`, `actions`) does not change.
- **A blocked candidate row could be confused with a failed check** → it has its own state and reason text, and it is excluded from the pending total.

## Migration Plan

- No configuration migration: `trustedRepositories` and `ignoredUpdates` keep their shape and meaning.
- Settled rows, diagnoses, blocked rows, and pending approvals are session state and are not backfilled.
- Ship both halves together as 0.3.0. The Host requirement range is unchanged.
- Rollback is a plugin downgrade: configuration is unchanged, and the previous version reads the same lists.

## Open Questions

- None blocking. Two tuning values were settled during implementation and stay adjustable without changing the specs: the detail grid goes two-column at 560px of panel-column width, and the copy confirmation reuses the existing toast hold (5s success, 8s failure).
- Whether the blocked candidate later moves into its own collapsed section remains a presentation detail: it is listed, non-actionable, and excluded from the pending total either way.
