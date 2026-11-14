# Spec Delta

## Purpose

Provides the main column view where the user reviews pending work, reads what changed, and starts updates individually or together, with a second tab for the settings that govern detection and build approval.

## ADDED Requirements

### Requirement: Panel with two tabs

The system SHALL provide a main panel with two tabs, one for pending work and one for settings. Opening the panel SHALL default to the pending-work tab.

#### Scenario: Opening the panel
- **WHEN** the user opens the panel
- **THEN** the pending-work tab is selected

#### Scenario: Switching tabs
- **WHEN** the user selects the settings tab
- **THEN** the settings content replaces the list without leaving the panel

### Requirement: Pending work list

The pending-work tab SHALL list only candidates that need attention: plugins with an available update, plugins needing a reload, and plugins whose check failed.

#### Scenario: Mixed pending work
- **WHEN** candidates have an available update, a pending reload, and a failed check
- **THEN** each appears as its own row with the action that applies to it

#### Scenario: Nothing pending
- **WHEN** no candidate needs attention and the last check succeeded
- **THEN** the tab states that everything is current and shows when it was last checked

#### Scenario: Nothing known yet
- **WHEN** no successful check has completed
- **THEN** the tab states that the state is unknown rather than that everything is current

#### Scenario: Ignored updates collapsed
- **WHEN** ignored updates exist
- **THEN** they appear in a collapsed section with a count and are absent from the main list

### Requirement: Per-plugin row content

Each row SHALL show the plugin name, its installation source, the installed and available identifiers, and the action available for it. A git row SHALL show the commit count when the version did not change. A row whose check failed SHALL show a small status indicator next to the name.

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

Each row SHALL offer the action that applies to it. The panel SHALL offer a batch action whenever at least one candidate is pending, including when only one is pending.

#### Scenario: Single pending candidate
- **WHEN** exactly one candidate is pending
- **THEN** the batch action is offered as well as the row action

#### Scenario: Starting a row action
- **WHEN** the user activates a row action
- **THEN** only that candidate is processed

#### Scenario: Ignored candidates in a batch
- **WHEN** the batch action runs and ignored updates exist
- **THEN** ignored candidates are not processed and the panel states how many were skipped

### Requirement: Row action states

A row SHALL show whether it is idle, running, completed, or failed, and a running row SHALL expose the package manager output on demand.

#### Scenario: Running row
- **WHEN** a candidate is being updated
- **THEN** its row shows the current step and is not actionable again until it settles

#### Scenario: Output on demand
- **WHEN** the user asks for the output of a running candidate
- **THEN** the package manager output is revealed within the row

#### Scenario: Failure reveals output
- **WHEN** a candidate fails
- **THEN** its output is revealed without the user asking

### Requirement: Batch completion summary

The system SHALL report the outcome of a batch by counting candidates per outcome, and SHALL offer a way to reach the detail when any candidate needs attention.

#### Scenario: Mixed batch outcome
- **WHEN** a batch finishes with two updated, one requiring approval, and one restored
- **THEN** the summary states those three counts and offers to open the detail

#### Scenario: Fully successful batch
- **WHEN** every candidate in a batch succeeded
- **THEN** the summary states the number updated without offering a failure detail

#### Scenario: Batch outcome without the panel open
- **WHEN** the batch finishes while the panel is closed
- **THEN** the same summary is presented outside the panel and reaching it opens the detail

### Requirement: Outstanding restart notice

The panel SHALL keep a restart requirement visible after it is reported, and SHALL clear it once the Host has restarted.

#### Scenario: Restart outstanding
- **WHEN** a completed update requires a restart
- **THEN** the panel shows a notice stating that a restart is required

#### Scenario: After restart
- **WHEN** the Host has restarted and the panel opens again
- **THEN** the notice is gone

### Requirement: Settings tab content

The settings tab SHALL let the user review and edit the trusted repository list, review and clear ignored updates, and see how much space the clone cache occupies.

#### Scenario: Editing trusted repositories
- **WHEN** the user adds or removes a repository entry
- **THEN** the change is saved and applies to subsequent updates

#### Scenario: Reviewing ignored updates
- **WHEN** the user opens the ignored list
- **THEN** each ignored update is shown with the candidate it belongs to and can be cleared

#### Scenario: Cache usage
- **WHEN** the settings tab renders
- **THEN** it reports the current cache size and the configured bound

### Requirement: Panel accessibility and theming

The panel SHALL use the host theme tokens for all surfaces and text, SHALL expose its tabs and rows to assistive technology, and SHALL NOT rely on literal colors for anything but artwork.

#### Scenario: Dark theme
- **WHEN** the interface runs in the dark theme
- **THEN** the panel renders with the host surfaces and text colors

#### Scenario: Tabs announced
- **WHEN** assistive technology reads the panel header
- **THEN** it announces both tabs and which one is selected

#### Scenario: Row action announced
- **WHEN** assistive technology reads a row
- **THEN** it announces the plugin, its state, and its available action
