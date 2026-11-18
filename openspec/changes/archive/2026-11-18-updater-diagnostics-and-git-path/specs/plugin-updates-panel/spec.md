# Spec Delta

## ADDED Requirements

### Requirement: Update diagnosis on the row

A failed row SHALL present the Host's failure code and diagnostic text as its reason, SHALL keep the package manager output available for that row, and SHALL NOT present a generic sentence in place of the Host's explanation.

#### Scenario: Failure reason visible
- **WHEN** an update fails
- **THEN** its row states the Host's failure code and diagnostic text

#### Scenario: No generic replacement
- **WHEN** the Host reported a failure with a diagnostic
- **THEN** the row does not replace that explanation with a generic failure sentence

#### Scenario: Diagnosis survives the snapshot refresh
- **WHEN** the row is rebuilt from a snapshot after the failed attempt
- **THEN** the diagnosis is still shown on that row

### Requirement: Copy update details

The panel SHALL offer an action on a failed row that copies that row's diagnosis to the clipboard as plain text, containing the plugin name, the installed and target identifiers, the Host's failure code and diagnostic text, and the package manager output tail when one exists. The panel SHALL confirm the copy without moving focus and without opening the panel from a closed state.

#### Scenario: Copy content
- **WHEN** the user activates copy on a failed row
- **THEN** the clipboard holds the plugin name, identifiers, failure code, diagnostic text, and the output tail when one exists

#### Scenario: Copy confirmed
- **WHEN** the copy completes
- **THEN** the panel confirms it transiently and focus stays where it was

#### Scenario: Copy without output
- **WHEN** the failed attempt produced no package manager output
- **THEN** the copied text omits the output section instead of claiming there is none

### Requirement: Candidate with no compatible version

The pending-work list SHALL show a candidate whose newer published versions are all incompatible with the running DSH as a non-actionable row that states that no compatible version is available. That row SHALL NOT offer an update action and SHALL NOT count toward the pending total or the header summary.

#### Scenario: Blocked row listed
- **WHEN** detection reports no compatible version for a registry candidate
- **THEN** the list shows its row with the explanation and no update action

#### Scenario: Blocked row not counted
- **WHEN** a blocked row is listed
- **THEN** the pending count and the header summary do not include it

#### Scenario: Actionable again after a compatible release
- **WHEN** a version compatible with the running DSH is published
- **THEN** the row offers the update action again and counts toward the pending total

## MODIFIED Requirements

### Requirement: Release notes presentation

The system SHALL present release notes and package manager output in one detail area on the row, collapsed until the user asks for them, and SHALL present the two side by side when both are available, stacking them when the panel is too narrow to hold two columns. Long note lists and long output SHALL scroll within the row. The package manager output SHALL open without being asked for when the update fails, as the exception to the collapsed default; the release notes SHALL stay collapsed.

#### Scenario: Notes expanded
- **WHEN** the user expands the notes of a git candidate
- **THEN** every available commit message is shown, scrolling within the row when the list is long

#### Scenario: Notes collapsed by default
- **WHEN** a row with notes first renders
- **THEN** the notes are collapsed

#### Scenario: Notes unavailable
- **WHEN** notes could not be obtained
- **THEN** the row states that no notes are available and why

#### Scenario: Notes and output side by side
- **WHEN** a row has both notes and output and both are open
- **THEN** they are shown side by side and neither hides the other

#### Scenario: Narrow panel stacks them
- **WHEN** the panel column is too narrow for two detail columns
- **THEN** the notes and the output are stacked instead

#### Scenario: Each detail collapses on its own
- **WHEN** the user collapses one detail while the other is open
- **THEN** the other stays open

#### Scenario: Failure output opens alone
- **WHEN** an update fails and the row has release notes and output
- **THEN** the output is open and the notes are still collapsed
