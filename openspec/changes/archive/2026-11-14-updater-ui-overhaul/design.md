# Design

See `proposal.md` for the motivation and `specs/` for the required behavior. This document explains how the behavior is produced.

## Context

The plugin ships plain ESM with no build step. Its host half is `index.js` plus `src/*`, and its browser half is one registered factory in `client.js`; the module table resolves only the `react` and `zod` seeds, and synchronous `require('./x')` is not supported (only `require.async` chunks), so the browser half must remain a single file.

The host owns every profile mutation through the plugin manager: `installBundle(spec, options)`, `updateBundle(name, version, options)`, `removeBundle(name)`, and `setBundleEnabled(name, enabled)`. The update service already composes those calls, restores the previous commit on failure, and resets the saved dependency spec. The hand-written Remote face in `src/remote.js` declares seven methods whose request and result shapes are mirrored in `client.js`.

On the browser side, the client store publishes a whole snapshot object on every change, derives rows with `rowsFromSnapshot`, and subscribes only to `plugin-manager/changed`. It calls `refresh()` (a full detection) on that event, replaces its rows from the host snapshot after every action, and rebuilds its state object without spreading the previous one.

The host's forwardable-event allowlist is a single app-level registration (`packages/api/remotes/src/remote-events.ts` in DSH) and a second registration throws. A plugin cannot forward its own events. The allowlist does include `plugin-manager/update-state`, `install-state`, `install-log`, and `changed`, and the plugin manager carries a caller-supplied `requestId` into those payloads.

The design platform exposes the tokens, primitives, and page conventions this plugin needs; the Plugin Manager page and the Toast primitive are the closest precedents. Icons, segmented tabs, and toasts cannot be imported by a third-party bundle, so their CSS is reproduced locally with host tokens.

## Goals / Non-Goals

**Goals:**

- Make every update observable: current step, streamed output, outcome, and a persisted result, including while the panel is closed.
- Keep the host as the single owner of profile mutation, ordering, restoration, and trust decisions.
- Give the browser half a one-way data flow with a pure view model and a store that can be tested without a DOM.
- Reach visual and accessibility parity with the host's page, list, tab, toast, and settings patterns.
- Leave the wire and the persisted configuration in a state a later version can read.

**Non-Goals:**

- Moving the batch queue into the client. Ordering, ignored-skip, restoration, and cancellation stay in the host.
- New capabilities (an installed-plugins list, update history, localization beyond English).
- A build pipeline, new files in the browser bundle, or changes to any DSH package.
- Persisting settled rows across an application restart; they are session state.

## Decisions

### Host remains the owner, with an observable run record

The host keeps `updateAll` as the queue and gains a small `run` record exposed in the snapshot: `{ startedAt, current?: { name, step, requestId }, results: [{ name, outcome, reason? }] }`. `run` exists only while a queue or a single update is executing; the call's return value remains the authoritative final result.

**Why:** moving the queue to the client would duplicate ordering (installations before reloads), ignored-skip counting, cancellation, and restoration, all of which already have host tests. What the client lacks is not control but visibility, and a run record supplies exactly that.

**Alternative rejected:** a client-side loop over `updateOne`. It would give per-item results for free, but it reimplements batch semantics in a place that cannot reuse the host's tested code, and it would still need host-side run state for the sidebar and the closed-panel notice.

**Consequence:** the client polls `snapshot()` while `run` is present (about every 500 ms), stops as soon as the run clears, and never polls when idle. Polling is an in-process call, not a network request.

### Progress comes from the plugin manager's forwarded events

Each candidate attempt is assigned a request id (`updater:<name>:<sequence>`) that the host passes to `installBundle`/`updateBundle`. The client subscribes once to `plugin-manager/update-state`, `install-state`, and `install-log`, maps payload request ids to the attempt named by `run.current`, and renders the step and output. Log chunks for an unknown request id are buffered briefly and attached when the run record names them; chunks that never match are dropped.

**Why:** the plugin's own events cannot reach the browser, and the manager's events are already forwarded. `update-state` supplies checking/removing/installing/restoring; `install-state` supplies installing/cancelling/applying; `install-log` supplies the streamed output under the same request id.

**Alternatives rejected:** registering a second remote event source (throws at runtime); polling only (no live log, visible latency); patching DSH (out of scope and not shippable).

**Cost:** log volume. The client caps the retained text at the host's own 8,000-character tail and coalesces appends to one publish per animation frame, so a chatty `pnpm` run cannot cause a render per line.

### Snapshot adoption merges, never replaces, session state

The store keeps two layers: `base`, the last host snapshot, and `session`, which holds active attempts, their streamed output, settled outcomes, dismissed names, the current notice, and a busy/error flag. Rows are derived from both. `adopt(base)` replaces only the base; it never clears notices, attempts, or settled rows. A manual check clears the settled attempts and dismissed names as it starts; an automatic check does not.

**Why:** the current single-object publish is the direct cause of the missing feedback: `adopt` rebuilds the state without `notice` or row outcomes, so the toast and the "Updated" row disappear milliseconds after they appear. Two layers make the lifetime of each fact explicit.

**Alternative rejected:** keeping one object and spreading it everywhere. It preserves values by convention, and one forgotten spread reproduces the bug.

### `plugin-manager/changed` refreshes the snapshot; it does not run detection

The store subscribes to `changed`, debounces it (about 250 ms, because a git update emits several changes), and calls `load()` — the snapshot read. Detection starts only at startup, on the interval, and on an explicit check.

**Why:** during a git update the manager emits `changed` after the removal and again after the installation. Treating each as a detection runs `git ls-remote` and possibly a clone while the plugin is absent, which is exactly the window in which the current panel makes the row disappear. A snapshot read is cheap, reflects the truth, and cannot race the update.

**Alternative rejected:** keeping `refresh()` but debouncing. It still pays a network round trip per update and can report a transient "candidate missing" state.

### The client is split into pure model, store, and components inside the single file

The browser half is organised as internal factories with explicit dependencies:

```text
client.js
  wire face registration (unchanged in shape)
  copy       strings + translate (three-way-synced with locale/en.json and src/strings.js)
  format     pure: source label, version/commit text, status tone and label, relative time
  model      pure: rows from base+session, header summary, toolbar state, notice model
  store      createStore({ remote, layout, translate, now, schedule }) — state, actions, events, polling
  components FooterEntry, Panel, Toolbar, Tabs, Row, ApprovalCard, Settings, Toast, EmptyState, Glyph
  apply      slot registration and lifecycle only
```

Components receive `{ model, actions, t }`; the store receives its dependencies as arguments; the model and format modules are pure and are exported from the bundle for tests, as `rowsFromSnapshot` already is. There is no module-level mutable state besides constants.

**Why:** the current file mixes protocol, copy, state, and ten components; every behavior bug above lives in the store, which cannot be tested without a DOM. Explicit dependency injection keeps the store testable with a fake remote and a fake timer, and keeps components presentational.

**Alternatives rejected:** separate source files (the module table cannot serve synchronous relative imports); `require.async` chunks (a loading state and split delivery for no runtime benefit); keeping one file but without internal boundaries (the store remains untestable).

### The view model owns row states

Rows expose a state union: `idle`, `queued`, `running`, `settled`, `failed`, plus `outcome` from the host (`updated`, `reloaded`, `restored`, `failed`, `needsApproval`, `cancelled`) and an optional step. `model.rows` merges the base rows with session attempts by name and appends settled rows that no longer appear in the base. Dismissed names are filtered. The row view never decides behavior; it renders the model.

**Why:** the current `state` strings mix lifecycle and outcome, and the row component decides labels and actions inline. One derivation makes the states testable and keeps the JSX free of business rules.

### Build approval is a host-owned record, replayed by the host

When a git attempt needs approval, the service stores `{ name, repository, savedSpec, previousCommit, targetCommit, keys }` in memory and exposes `approvals` in the snapshot. A decision method `decideBuild({ name, decision })` accepts `allow`, `always-allow`, or `decline`. Allow re-runs the update with the retained keys pre-approved (the same path the trusted automatic approval already uses); always-allow adds the repository to the trusted list first; decline deletes the record. The record is dropped only when the plugin disappears: a moved HEAD does not make the decision about the retained commit meaningless.

**Why:** the client must never send the approval keys or the install spec back. The host already extracted those keys from the package manager output and validated them; replaying a client-supplied value would let a compromised renderer approve an arbitrary script. Keeping the record on the host also makes the request survive the snapshot rebuild that follows the failed attempt.

**Alternative rejected:** returning the keys and spec to the client so the approval card could call `installBundle` itself. It widens the trust boundary and duplicates the restore-then-install sequence.

### Trust is resolved on the host from the candidate, not from client input

`trustRepository({ name })` resolves the candidate's saved git spec, normalises it with the existing trust parser, adds the exact identity, writes the configuration through `configEditor`, and returns the new snapshot. Rows are marked trusted by comparing the candidate's already-normalised `repository` identity with the snapshot's trusted list.

**Why:** the saved spec is the only trustworthy source of the repository (the package manifest can differ or be absent), and the trust rules (no wildcards, host plus path, lowercase) already live in `src/trust.js`. A client-supplied repository string would bypass those rules.

### Per-candidate re-check reuses the check pipeline for one candidate

`recheck({ name })` waits for any running detection to settle, re-reads the installed bundles, runs `runCheck` with that single candidate and its installed commit, then merges the result into the last check: the name is removed from `updates`, `ignored`, and `unchecked`, and the new state is appended to the matching set; the pending total is recomputed. The last full check timestamp is kept.

**Why:** reusing `runCheck` keeps ignore handling, git/registry paths, and failure containment identical. Replacing one name avoids re-running network work for every other candidate, which is the point of the retry control.

**Consequence:** `CheckScheduler` gains a small `whenIdle()` that awaits the running cycle, so a re-check never runs concurrently with detection and never silently returns null.

### Visual composition follows the host, not a local re-design

- Page: centered column (max 960px) with `clamp(24px, 4vw, 48px)` inline inset; 20px/500 title; 13px secondary intro; the last check sits at the header's end; 32px section gaps.
- Tabs: a local copy of the host SegmentedTabs — equal-width grid, 34px tabs, 4px inset, `bg-module-platform` track, `bg-layer-3` indicator, 500 weight when selected (the host's small variant, within the feature-CSS weight ceiling), arrow/Home/End handling, `aria-controls`, roving tab stop.
- Toolbar: fixed at the top of the pending-work area; "Check now" (secondary), "Update all" (primary, 32px, `radius-md`); cancel replaces the primary while running.
- List: flat rows separated by `border-bottom: 0.5px solid var(--dsw-alias-border-l2)`, 12px vertical padding, hover surface under `@media (hover: hover)`, 13.5px/500 name, 12px tertiary meta, toned status badge.
- Settings: `--dsw-alias-settings-card-fill` cards with `--dsw-alias-settings-card-stroke`, `radius-xl`, section headers 14px/500.
- Toast: top-center fixed, `--dsw-alias-toast-bg`/`--dsw-alias-toast-label`, `--dsw-shadow-lv3`, `role="alert"`, hold then fade, success glyph, action text in `--dsw-static-deepseek-400`.
- Sidebar entry: existing row structure; 16px upward-arrow-in-circle glyph; count right-aligned with tabular numerals; 26px refresh; 5px amber dot for a failed check; corner badge when collapsed; the refresh glyph spins while checking and a matching indicator covers a running update.

**Why:** the host's own Plugin Manager page is the precedent users already see, and the tokens keep both themes correct. Re-inventing the visual language is how the current panel drifted.

**Token corrections:** `--dsw-alias-border-secondary` → `--dsw-alias-border-l2`/`l3`/`l4`; `--dsw-alias-label-inverse` → `--dsw-alias-label-primary-inverted`; `--dsw-alias-surface-overlay` → `--dsw-alias-bg-overlay`; `--dsw-alias-surface-sunken` → `--dsw-alias-bg-layer-2`. Tones use `color-mix` over state tokens (10–12% surface) instead of literal colors. Focus uses `--dsw-focus-ring-width`/`--dsw-focus-ring-color`; motion is dropped under `prefers-reduced-motion`.

### Accessibility is part of the component contract

Tabs and panels use `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, and arrow/Home/End handling. Row actions carry the plugin name in their accessible name. A visually hidden `aria-live="polite"` region announces step changes and settled outcomes without moving focus. The toast is `role="alert"`. The failure dot has an accessible name and a title, and the refresh control has its own name.

### The wire face and the host contract change together

`src/remote.js` and the embedded face in `client.js` both gain `recheck`, `trustRepository`, and `decideBuild`; the snapshot schema gains `run` and `approvals` and loses `proposedRepositories`. A new test loads the browser face and compares its method names, request schemas, and result codecs with `src/remote.js` so the two copies cannot drift silently.

**Why:** the hand-written face is duplicated by necessity, and today nothing guards the copies against divergence. The comparison test is cheap and catches the failure mode that a copied protocol always has.

### Testing strategy

- Pure `format` and `model` functions are exported from the bundle and tested through the existing module-table harness with a React stub.
- `createStore` is exported and tested with a fake remote (recorded calls, controllable promises), a fake event emitter, and a fake clock: single update success and failure, per-step progress, log throttling and cap, adopt preserving session state, notice lifetime, dismiss, manual check clearing settled rows, per-item batch results, trust, recheck, and the three approval decisions.
- Host tests cover `run`, `recheck`, `trustRepository`, and `decideBuild`; existing restoration and spec-reset tests must keep passing.
- No new dependency and no DOM library: the tests assert models and calls, not rendered markup.

## Risks / Trade-offs

- **Streamed output volume** → cap at the host's 8,000-character tail, coalesce appends to one publish per frame, and stop appending when the attempt settles.
- **Polling overhead** → only while a run exists, one in-process call every ~500 ms, cleared on settle; no network cost.
- **Host-scheduled detection start is not forwarded** → the panel cannot show a running indicator for a check it did not start, because the host forwards no check-state event to a third-party plugin. The same was true before this change; the result appears on the next snapshot read, and a forwarded DSH event would close the gap. The refresh control covers checks the panel starts.
- **Progress events from other plugin-manager operations** → every event is matched by the run record's request id; unmatched events are ignored, so the plugin manager's own installs cannot paint this panel.
- **Row-state complexity** → one merge function with an explicit state union, covered by model and store tests; components never branch on host payloads.
- **Snapshot compatibility** → removing `proposedRepositories` changes the plugin's own wire. No other consumer is known; the plugin version is bumped to 0.2.0 and the README notes the change.
- **Approval record is memory-only** → a restart loses a pending request, but the failed attempt already restored the previous version, so the user simply retries. Acceptable and documented.
- **Settled rows are memory-only** → an application restart clears them; the restart notice and pending work are host state and survive.
- **CSS relies on host tokens that are not a formal public API** → the tokens are already used by the plugin; a rename would be caught visually, not by tests. The risk is accepted because reproducing colors locally would break both themes.
- **Longer first render** → the bundle grows with the new model and components, but remains a single file with no extra request.

## Migration Plan

- No configuration migration: `trustedRepositories` and `ignoredUpdates` keep their shape and meaning. Existing trusted repositories remain trusted; nothing becomes trusted automatically.
- The first-use proposal is gone. A user who had not decided before sees a trust action on each untrusted git row instead of a batch confirmation.
- Existing settled rows and pending approvals are in-memory only, so there is nothing to backfill.
- Ship the client and host halves together (one plugin update) and bump the package version to 0.2.0. The host still requires the existing DSH range.
- Rollback is a plugin downgrade: configuration is unchanged and the previous version reads the same lists.

## Open Questions

- The exact poll interval, log flush interval, and toast hold durations are tuning values; they can be adjusted during implementation without changing the specs or the approach.
