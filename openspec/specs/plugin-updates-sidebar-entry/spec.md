# plugin-updates-sidebar-entry Specification

## Purpose
Puts a permanent entry above Settings in the sidebar footer that tells the user how many plugins need attention and lets them refresh without opening anything.

## Requirements

### Requirement: Sidebar footer entry

The system SHALL contribute one permanent entry to the sidebar footer, rendered above the Settings control, and SHALL NOT add an entry to the sidebar panel list or the panels overflow menu.

#### Scenario: Entry present above Settings
- **WHEN** the sidebar renders in its expanded state
- **THEN** the entry appears above the Settings control

#### Scenario: No duplicate entry in the panel list
- **WHEN** the sidebar panel list renders
- **THEN** it contains no entry for this plugin

#### Scenario: No duplicate entry in the overflow menu
- **WHEN** the panels overflow menu opens
- **THEN** it does not list this plugin

### Requirement: Expanded footer row layout

In the expanded sidebar the entry SHALL show an icon, a label, a numeric count aligned to the right, and a refresh control, all on one row. Activating the icon or the label SHALL open the panel. Activating the refresh control SHALL start a detection without opening the panel.

#### Scenario: Opening the panel from the row
- **WHEN** the user activates the icon or the label
- **THEN** the panel opens in the main column

#### Scenario: Refreshing from the row
- **WHEN** the user activates the refresh control
- **THEN** a detection starts and the panel does not open

#### Scenario: Count placement
- **WHEN** the row renders with pending work
- **THEN** the count appears to the right of the label, visually associated with the refresh control

### Requirement: Pending count

The count SHALL include plugins with an available update, plugins installed from a local directory that need a reload, and plugins whose check failed. The count SHALL show `9+` when the total exceeds nine.

#### Scenario: Count includes all three kinds
- **WHEN** two plugins have updates, one needs a reload, and one failed its check
- **THEN** the count shows four

#### Scenario: Count above nine
- **WHEN** ten or more plugins need attention
- **THEN** the count shows `9+`

#### Scenario: Nothing pending
- **WHEN** no plugin needs attention and the last detection succeeded
- **THEN** the entry shows no count

### Requirement: Check failure indication

The entry SHALL indicate that a plugin check failed, distinctly from plugins having updates, and SHALL indicate when the displayed count is not current.

#### Scenario: One check failed
- **WHEN** a candidate could not be checked
- **THEN** the entry shows a small indicator distinct from the update count

#### Scenario: Count not current
- **WHEN** the last detection failed
- **THEN** the entry marks the displayed information as not current

#### Scenario: Failure detail
- **WHEN** the user opens the panel after a failed check
- **THEN** the affected row states why that plugin could not be checked

### Requirement: Collapsed sidebar rendering

In the collapsed sidebar the entry SHALL render as an icon bearing the count as a corner badge, and SHALL omit the label, the numeric text, and the refresh control.

#### Scenario: Collapsed rendering
- **WHEN** the sidebar is collapsed
- **THEN** the entry shows only its icon with the count as a corner badge

#### Scenario: Collapsed activation
- **WHEN** the user activates the entry while the sidebar is collapsed
- **THEN** the panel opens

#### Scenario: Collapsed with nothing pending
- **WHEN** the sidebar is collapsed and nothing needs attention
- **THEN** the entry shows its icon without a badge

### Requirement: Refresh progress

While a detection runs, the refresh control SHALL show that a check is in progress, and the count SHALL remain unchanged rather than clearing.

#### Scenario: Detection running
- **WHEN** a detection is in progress
- **THEN** the refresh control indicates progress and the count keeps its previous value

#### Scenario: Detection finished
- **WHEN** the detection completes
- **THEN** the refresh control stops indicating progress and the count reflects the new result

### Requirement: Accessibility of the entry

The entry SHALL expose its label, its pending count, and any check failure to assistive technology, and the refresh control SHALL have its own accessible name.

#### Scenario: Screen reader reads the entry
- **WHEN** assistive technology reads the entry
- **THEN** it announces the label and the pending count

#### Scenario: Screen reader reads the refresh control
- **WHEN** assistive technology reads the refresh control
- **THEN** it announces an action name that distinguishes it from opening the panel

#### Scenario: Keyboard activation
- **WHEN** the user focuses the entry and activates it from the keyboard
- **THEN** the panel opens, and the refresh control is separately focusable
