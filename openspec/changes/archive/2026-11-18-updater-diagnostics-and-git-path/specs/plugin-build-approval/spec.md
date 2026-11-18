# Spec Delta

## MODIFIED Requirements

### Requirement: Approval is disclosed

The system SHALL record every build-script approval in the Host log and SHALL NOT present approved entries as row content: a completed row SHALL show only its outcome, and approved entries SHALL NOT be sent to the browser. A pending approval request SHALL remain the only place where the exact entries are shown.

#### Scenario: Automatic approval reported
- **WHEN** a build script is approved automatically during an update
- **THEN** the outcome states that the update completed and the Host log records the repository and the entries added

#### Scenario: Approval visible afterwards
- **WHEN** the user reviews a completed update that required approval
- **THEN** the row shows only its outcome and the Host log holds the record of what was approved

#### Scenario: Decision shown in the row
- **WHEN** the user allows an approval request
- **THEN** the pending request names the repository and the exact entries the decision applies to

#### Scenario: Approved entries never reach the browser
- **WHEN** an update that needed approval settles
- **THEN** the snapshot and the update result carry no approved-entry field
