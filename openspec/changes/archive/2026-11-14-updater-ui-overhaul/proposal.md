# Proposal

## Why

The updater works, but its panel does not communicate what it is doing. A single update runs in the background, the row disappears from the list, and the only trace left is a list that silently changed — the user never learns whether the update succeeded, failed, or is still running. The interface also ignores the host's design system: tabs are small text buttons pushed into a corner, "Update all" sits in a footer detached from the list, rows show name, source, version and state in one undifferentiated line, and four theme tokens that do not exist fall back to literal colors. The first-use trust proposal and the build-script approval request are presented as text with no action, which leaves spec-required behavior unreachable from the UI.

The same investigation found concrete defects behind the symptoms: the client discards every completed row state and completion notice on the snapshot reload that follows an update; a plugin-manager change triggers a full network re-check instead of a snapshot read, so the list churns mid-update; and "Try again" on a failed check starts an update instead of a re-check. Fixing the presentation without fixing these would leave the panel pretty and still silent, so this change treats feedback, layout, and the underlying client state model as one piece of work.

## What Changes

- **Panel shell and navigation**: adopt the host page layout (centered column, host insets, 20px/500 title, intro line), replace the corner text buttons with the host's segmented tab pattern (equal-width, keyboard navigation, `aria-controls`, `tabpanel`), and move "Update all" into a sticky toolbar with the pending summary, last-check time and "Check now".
- **Pending list**: replace the bordered rows with hairline-separated flat rows; show source as a chip, versions with tabular numerals, state as a toned badge; keep release notes, output and failure reasons as inline expansions. Logs stay collapsed by default and open automatically on failure.
- **Live update feedback**: pass a request id to the plugin manager and consume the events the host already forwards (`plugin-manager/update-state`, `install-state`, `install-log`); render the current step on the row and stream the package manager output; publish per-item results during a batch instead of only at the end; show the completion toast for single updates as well as batches, including while the panel is closed.
- **Completed and failed rows**: keep the final state on the list until the next manual check, with a dismiss control per row and the next manual check clearing the completed set. This changes the panel's "only pending work" rule.
- **Build approval**: present the exact pending approval keys inline with "Allow and install", "Always allow this repository" and "Not now"; keep the pending request on the host so the decision can be applied after the row is restored.
- **Repository trust**: replace the batch first-use onboarding with a "Trust this repository" action on every untrusted git row; nothing is trusted without that action, and the `proposedRepositories` snapshot field and `onboarding.*` copy are removed.
- **Sidebar entry**: keep the row structure, replace the full-sentence failure pill with a small dot plus accessible tooltip, use an upward-arrow-in-circle glyph instead of the clock, show a checking/progress state, and tidy the spacing of the count and refresh control.
- **Settings tab**: apply the same page shell and typography, and group trusted repositories, ignored updates and cache usage into host-style cards with the same empty, validation and focus states.
- **Retry**: "Try again" on a failed check re-checks only that plugin (new host method) instead of starting an update.
- **Hardening and cleanup**: fix literal-color fallbacks and use real theme tokens, restore focus/hover/reduced-motion behavior, preserve notices across snapshot reloads, stop re-running detection on every plugin-manager change, render the last failure and running state, and split `client.js` internally into formatting, pure view-model, store and small components with dependency injection and tests that need no DOM.
- **BREAKING**: the wire snapshot no longer carries `proposedRepositories`; the first-use batch trust onboarding is removed in favor of per-row trust.

## Capabilities

### New Capabilities

None. The change modifies existing capabilities.

### Modified Capabilities

- `plugin-updates-panel`: new page shell and segmented navigation, sticky action toolbar, flat pending list with toned badges and inline detail, live progress and collapsed log, persistent completed/failed rows with dismiss, inline build-approval card, per-row trust action, redesigned Settings tab, and updated accessibility requirements.
- `plugin-update-application`: per-step progress and live package manager output, per-item results during a batch, completion notice for single updates and batches including with the panel closed, and a manual per-candidate re-check used by "Try again".
- `plugin-update-detection`: a manual re-check of one failed candidate that leaves the other candidates' results untouched.
- `plugin-build-approval`: per-row repository trust replaces the batch first-use onboarding; the approval request is presented with allow, always-allow and decline actions and is retained until decided.
- `plugin-updates-sidebar-entry`: dot-based check-failure indication, upward-arrow glyph, and a detection/update progress state.

## Impact

- `client.js`: full UI rewrite in place (page shell, tabs, toolbar, rows, approval card, Settings, toast, sidebar entry), plus the internal split into formatting, view-model, store and components. The bundle remains a single file because the module table only resolves `react` and `zod`.
- `src/host.js`: request-id threading, active-run state exposed in the snapshot, per-candidate re-check, retained approval request, and trust helpers.
- `src/remote.js` and the bundle's wire face: new methods and snapshot fields; removal of `proposedRepositories`.
- `src/apply.js`, `src/approve.js`, `src/build-approval.js`: approval decision plumbing for a later allow/always-allow/decline action.
- `src/strings.js`, `locale/en.json` and the inline bundle dictionary: new English copy, removal of the onboarding keys, and the existing three-way sync test extended to the new keys.
- `test/`: new tests for the view-model and store sequences without a DOM, plus contract, approval and re-check coverage.
- `README.md` and `INSTALL-CHECKLIST.md`: behavior and wording updates.
- No new runtime dependency, no build step, and no change to the host's own packages.
