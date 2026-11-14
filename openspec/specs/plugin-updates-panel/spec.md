# plugin-updates-panel Specification

## Purpose
Provides the main column view where the user reviews pending work, reads what changed, and starts updates individually or together, with a second tab for the settings that govern detection and build approval.

## Requirements

### Requirement: Panel with two tabs

The system SHALL provide a main panel with two tabs, one for pending work and one for settings. The tabs SHALL be presented as an equal-width segmented control below the panel header. Opening the panel SHALL default to the pending-work tab. Selecting a tab SHALL replace the panel content without leaving the panel.

#### Scenario: Opening the panel
- **WHEN** the user opens the panel
- **THEN** the pending-work tab is selected and its content is shown

#### Scenario: Switching tabs
- **WHEN** the user selects the settings tab
- **THEN** the settings content replaces the list without leaving the panel

#### Scenario: Selected tab is evident
- **WHEN** the panel renders
- **THEN** the selected tab is visually distinguished from the other tab and exposed as selected to assistive technology

### Requirement: Pending work list

The pending-work tab SHALL list the candidates that need attention: plugins with an available update, plugins needing a reload, and plugins whose check failed. A candidate that settled during this session SHALL remain in the same list with its final state while the settled-results requirement applies. Ignored updates SHALL remain in a collapsed section with a count and SHALL be absent from the main list.

#### Scenario: Mixed pending work
- **WHEN** candidates have an available update, a pending reload, and a failed check
- **THEN** each appears as its own row with the action that applies to it

#### Scenario: Nothing pending
- **WHEN** no candidate needs attention and the last check succeeded
- **THEN** the tab states that everything is current and shows when it was last checked

#### Scenario: Nothing known yet
- **WHEN** no successful check has completed
- **THEN** the tab states that the state is unknown rather than that everything is current

#### Scenario: Last check failed
- **WHEN** the last check failed and no successful check has completed since
- **THEN** the tab states that the check failed and offers to check again rather than claiming everything is current

#### Scenario: Ignored updates collapsed
- **WHEN** ignored updates exist
- **THEN** they appear in a collapsed section with a count and are absent from the main list

#### Scenario: Settled row remains listed
- **WHEN** a candidate settles and other candidates are still pending
- **THEN** the settled row stays in the same list beside the pending rows with its final state

### Requirement: Per-plugin row content

Each row SHALL show the plugin name, its installation source as a short chip, the installed and available identifiers, and the action available for it. A git row SHALL show the commit count when the version did not change. A row whose check failed SHALL show a compact status indicator beside the name and state the reason. A git row whose repository is not trusted SHALL offer the repository trust action.

#### Scenario: Registry row
- **WHEN** a registry candidate has an update
- **THEN** the row shows the installed and available versions and identifies the source as the registry

#### Scenario: Git row with version change
- **WHEN** a git candidate's new commit declares a different version
- **THEN** the row shows the installed and available versions

#### Scenario: Git row without version change
- **WHEN** a git candidate's new commit declares the same version
- **THEN** the row shows the number of new commits instead of a version change

#### Scenario: Local row
- **WHEN** a local candidate needs a reload
- **THEN** the row identifies it as a local installation and offers a reload action

#### Scenario: Failed check row
- **WHEN** a candidate could not be checked
- **THEN** the row shows a status indicator beside the name, states the reason, and offers a retry

#### Scenario: Untrusted git row
- **WHEN** a git candidate's repository is not in the trusted list
- **THEN** the row offers the action to trust that repository

### Requirement: Release notes presentation

The system SHALL present release notes inline on the row, collapsed until the user asks for them, and SHALL allow long note lists to scroll within the row.

#### Scenario: Notes expanded
- **WHEN** the user expands the notes of a git candidate
- **THEN** every available commit message is shown, scrolling within the row when the list is long

#### Scenario: Notes collapsed by default
- **WHEN** a row with notes first renders
- **THEN** the notes are collapsed

#### Scenario: Notes unavailable
- **WHEN** notes could not be obtained
- **THEN** the row states that no notes are available and why

### Requirement: Individual and batch actions

Each row SHALL offer the action that applies to it. The pending-work tab SHALL offer a batch action in its toolbar whenever at least one candidate is pending, including when only one is pending. The toolbar SHALL remain visible while the list scrolls.

#### Scenario: Single pending candidate
- **WHEN** exactly one candidate is pending
- **THEN** the batch action is offered as well as the row action

#### Scenario: Starting a row action
- **WHEN** the user activates a row action
- **THEN** only that candidate is processed

#### Scenario: Ignored candidates in a batch
- **WHEN** the batch action runs and ignored updates exist
- **THEN** ignored candidates are not processed and the panel states how many were skipped

#### Scenario: Batch action stays reachable
- **WHEN** the list is long enough to scroll
- **THEN** the toolbar with the batch action remains visible while the list scrolls

### Requirement: Row action states

A row SHALL show whether it is idle, running, settled, or failed. A running row SHALL be identified as running, SHALL show the current step, and SHALL NOT be actionable again until it settles. A settled row SHALL show its final outcome. The package manager output SHALL be available on demand and SHALL be revealed without the user asking when the candidate fails.

#### Scenario: Running row
- **WHEN** a candidate is being updated
- **THEN** its row shows the current step and is not actionable again until it settles

#### Scenario: Output on demand
- **WHEN** the user asks for the output of a running candidate
- **THEN** the package manager output is revealed within the row

#### Scenario: Failure reveals output
- **WHEN** a candidate fails
- **THEN** its output is revealed without the user asking

#### Scenario: Settled row shows its outcome
- **WHEN** a candidate finishes
- **THEN** its row states the outcome and any detail the outcome carries

### Requirement: Batch completion summary

The system SHALL report the outcome of a batch by counting candidates per outcome and SHALL offer a way to reach the detail when any candidate needs attention. Each candidate's row SHALL show that candidate's own outcome as soon as it settles, without waiting for the queue to finish.

#### Scenario: Mixed batch outcome
- **WHEN** a batch finishes with two updated, one requiring approval, and one restored
- **THEN** the summary states those three counts and offers to open the detail

#### Scenario: Fully successful batch
- **WHEN** every candidate in a batch succeeded
- **THEN** the summary states the number updated without offering a failure detail

#### Scenario: Batch outcome without the panel open
- **WHEN** the batch finishes while the panel is closed
- **THEN** the same summary is presented outside the panel and reaching it opens the detail

#### Scenario: Per-item outcome during the batch
- **WHEN** the first candidate of a batch settles while later candidates are still queued
- **THEN** that candidate's row already shows its outcome

### Requirement: Outstanding restart notice

The panel SHALL keep a restart requirement visible after it is reported, and SHALL clear it once the Host has restarted.

#### Scenario: Restart outstanding
- **WHEN** a completed update requires a restart
- **THEN** the panel shows a notice stating that a restart is required

#### Scenario: After restart
- **WHEN** the Host has restarted and the panel opens again
- **THEN** the notice is gone

### Requirement: Settings tab content

The settings tab SHALL let the user review and edit the trusted repository list, review and clear ignored updates, and see how much space the clone cache occupies. The content SHALL be presented in grouped sections that use the same page layout, typography, and control styles as the pending-work tab.

#### Scenario: Editing trusted repositories
- **WHEN** the user adds or removes a repository entry
- **THEN** the change is saved and applies to subsequent updates

#### Scenario: Reviewing ignored updates
- **WHEN** the user opens the ignored list
- **THEN** each ignored update is shown with the candidate it belongs to and can be cleared

#### Scenario: Cache usage
- **WHEN** the settings tab renders
- **THEN** it reports the current cache size and the configured bound

#### Scenario: Empty section
- **WHEN** a settings section has no entries
- **THEN** the section explains that state instead of rendering an empty area

### Requirement: Panel accessibility and theming

The panel SHALL use the host theme tokens for all surfaces and text, SHALL expose its tabs, panels, and rows to assistive technology, and SHALL NOT rely on literal colors for anything but artwork. The tab list SHALL follow the host tab pattern: each tab exposes its selected state and controls its panel, arrow keys and Home/End move selection, and only the selected tab is a tab stop. Each row action SHALL have an accessible name that identifies the plugin and the action. Progress and completion SHALL be announced without moving focus. Focus indicators SHALL be visible and motion SHALL respect the reduced-motion preference.

#### Scenario: Dark theme
- **WHEN** the interface runs in the dark theme
- **THEN** the panel renders with the host surfaces and text colors

#### Scenario: Tabs announced
- **WHEN** assistive technology reads the panel header
- **THEN** it announces both tabs and which one is selected

#### Scenario: Row action announced
- **WHEN** assistive technology reads a row
- **THEN** it announces the plugin, its state, and its available action

#### Scenario: Progress announced
- **WHEN** a candidate starts, advances a step, or settles
- **THEN** the change is announced without moving focus

#### Scenario: Keyboard tabs
- **WHEN** focus is on the tab list and the user presses an arrow key or Home/End
- **THEN** the selection moves to the corresponding tab

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the panel does not animate the tab indicator or other transitions

### Requirement: Panel page header

The panel SHALL present a page header with the panel title, a one-line summary of the pending work, and the outcome of the last check. The header SHALL state when the displayed information is not current because the last check failed.

#### Scenario: Summary reflects the pending work
- **WHEN** two updates and one reload are pending
- **THEN** the header summary states that three plugins need attention

#### Scenario: Last check shown
- **WHEN** a successful check has completed
- **THEN** the header states when it happened

#### Scenario: Failed check marked
- **WHEN** the last check failed and previous results remain displayed
- **THEN** the header states that the information is not current

### Requirement: Settled results remain visible

After a candidate settles, the panel SHALL keep its final state in the pending-work list together with the outcome and any retained detail. The row SHALL remain until the user dismisses it or a manual check starts. The panel SHALL offer a dismiss control on every settled row. Starting a manual check SHALL clear the settled rows, and an automatic check SHALL NOT clear them.

#### Scenario: Successful update retained
- **WHEN** a candidate is updated successfully
- **THEN** its row states that it was updated and remains in the list

#### Scenario: Failed update retained with detail
- **WHEN** a candidate fails
- **THEN** its row states the failure and keeps the output available

#### Scenario: Dismiss one settled row
- **WHEN** the user dismisses a settled row
- **THEN** only that row is removed from the list

#### Scenario: Manual check clears settled rows
- **WHEN** the user starts a manual check
- **THEN** every settled row is removed as the new check starts

#### Scenario: Automatic check keeps settled rows
- **WHEN** the scheduled check runs while a settled row is displayed
- **THEN** that row remains until the user dismisses it or starts a manual check

### Requirement: Live progress and package manager output

While a candidate is being updated, the panel SHALL show the current step among checking, removing, installing, restoring, and reloading, and SHALL update the row as the step changes. The package manager output SHALL stream into the row as it is produced. The output SHALL be collapsed by default, SHALL be revealed on demand, and SHALL be revealed automatically when the candidate fails.

#### Scenario: Steps advance on the row
- **WHEN** a git candidate moves from removing to installing
- **THEN** its row shows the new step without the user reopening anything

#### Scenario: Output collapsed by default
- **WHEN** a candidate starts running
- **THEN** its package manager output is not shown until requested

#### Scenario: Output revealed on demand
- **WHEN** the user asks to see the output while the candidate runs
- **THEN** the output produced so far is shown and continues to update

#### Scenario: Failure reveals the output
- **WHEN** the candidate fails
- **THEN** the output is shown without the user asking

#### Scenario: Output stops at settle
- **WHEN** the candidate settles
- **THEN** no further output is appended to the row

### Requirement: Build approval presented inline

The panel SHALL present a build-script approval request on the affected candidate's row, naming the exact entries the package manager reported, with actions to allow and install, to always allow the repository and install, and to decline. The request SHALL remain available until the user decides. The panel SHALL NOT leave the user with an unactionable needs-approval label.

#### Scenario: Request names the exact entries
- **WHEN** a candidate needs build-script approval
- **THEN** its row names the exact entries that require approval

#### Scenario: Allow and install
- **WHEN** the user allows the request
- **THEN** the candidate is installed with exactly those entries and its row reports the outcome

#### Scenario: Always allow the repository
- **WHEN** the user chooses to always allow the repository
- **THEN** the repository is added to the trusted list and the candidate is installed

#### Scenario: Decline keeps the previous version
- **WHEN** the user declines the request
- **THEN** the previously installed version remains in place

#### Scenario: Request survives a reload
- **WHEN** the row is rebuilt from a snapshot after the failed attempt
- **THEN** the request is still shown and still actionable
