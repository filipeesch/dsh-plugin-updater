# Spec Delta

## MODIFIED Requirements

### Requirement: Expanded footer row layout

In the expanded sidebar the entry SHALL show an icon, a label, a numeric count aligned to the right, and a refresh control, all on one row. Activating the icon or the label SHALL open the panel. Activating the refresh control SHALL start a detection without opening the panel. A check failure SHALL be indicated by a small dot beside the count with an accessible name, not by a text label.

#### Scenario: Opening the panel from the row
- **WHEN** the user activates the icon or the label
- **THEN** the panel opens in the main column

#### Scenario: Refreshing from the row
- **WHEN** the user activates the refresh control
- **THEN** a detection starts and the panel does not open

#### Scenario: Count placement
- **WHEN** the row renders with pending work
- **THEN** the count appears to the right of the label, visually associated with the refresh control

#### Scenario: Failure is compact
- **WHEN** a plugin check failed
- **THEN** the row shows a small dot beside the count instead of a sentence

### Requirement: Check failure indication

The entry SHALL indicate that a plugin check failed, distinctly from plugins having updates, and SHALL indicate when the displayed count is not current. The failure indication SHALL expose its meaning to assistive technology and SHALL name what failed on request.

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

In the collapsed sidebar the entry SHALL render as an icon bearing the count as a corner badge, and SHALL omit the label, the numeric text, and the refresh control. The same entry SHALL indicate a check failure and a running update while collapsed.

#### Scenario: Collapsed rendering
- **WHEN** the sidebar is collapsed
- **THEN** the entry shows only its icon with the count as a corner badge

#### Scenario: Collapsed activation
- **WHEN** the user activates the entry while the sidebar is collapsed
- **THEN** the panel opens

#### Scenario: Collapsed with nothing pending
- **WHEN** the sidebar is collapsed and nothing needs attention
- **THEN** the entry shows its icon without a badge

#### Scenario: Collapsed failure
- **WHEN** the sidebar is collapsed and a check failed
- **THEN** the entry indicates the failure without a text label

### Requirement: Refresh progress

While a detection runs, the refresh control SHALL show that a check is in progress, and the count SHALL remain unchanged rather than clearing. While an update runs, the entry SHALL indicate that work is in progress even when the panel is closed.

#### Scenario: Detection running
- **WHEN** a detection is in progress
- **THEN** the refresh control indicates progress and the count keeps its previous value

#### Scenario: Detection finished
- **WHEN** the detection completes
- **THEN** the refresh control stops indicating progress and the count reflects the new result

#### Scenario: Update running
- **WHEN** an update is in progress and the panel is closed
- **THEN** the entry indicates that work is in progress and the count keeps its previous value

### Requirement: Accessibility of the entry

The entry SHALL expose its label, its pending count, its failure indication, and whether work is in progress to assistive technology, and the refresh control SHALL have its own accessible name.

#### Scenario: Screen reader reads the entry
- **WHEN** assistive technology reads the entry
- **THEN** it announces the label, the pending count, and any failure or progress state

#### Scenario: Screen reader reads the refresh control
- **WHEN** assistive technology reads the refresh control
- **THEN** it announces an action name that distinguishes it from opening the panel

#### Scenario: Keyboard activation
- **WHEN** the user focuses the entry and activates it from the keyboard
- **THEN** the panel opens, and the refresh control is separately focusable
