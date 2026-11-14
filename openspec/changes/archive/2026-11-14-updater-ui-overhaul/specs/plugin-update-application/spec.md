# Spec Delta

## MODIFIED Requirements

### Requirement: Batch update execution

The system SHALL execute a batch sequentially, SHALL continue to the remaining candidates after a candidate fails, and SHALL finish with the candidate installed from a local directory last. The system SHALL report each candidate's outcome as soon as that candidate settles, without waiting for the queue to finish.

#### Scenario: One candidate fails in a batch
- **WHEN** one candidate fails while others remain
- **THEN** the failed candidate is restored and the remaining candidates are still attempted

#### Scenario: Local plugin in the batch
- **WHEN** a batch includes a local plugin needing reload and plugins needing installation
- **THEN** installation candidates are processed first and the local reload is last

#### Scenario: Progress visibility
- **WHEN** a batch is running
- **THEN** each candidate shows its own state and the running candidate exposes its package manager output

#### Scenario: Closing the panel during a batch
- **WHEN** the user closes the panel while a batch is running
- **THEN** the batch continues and the progress and final result are reported outside the panel

#### Scenario: Per-item outcome before the queue ends
- **WHEN** one candidate of a batch settles while later candidates are still queued
- **THEN** the settled candidate's outcome is reported without waiting for the queue

## ADDED Requirements

### Requirement: Update completion notice

Every settled update SHALL produce a completion notice, for a single candidate and for a batch, whether the panel is open or closed. The notice SHALL state the outcome, SHALL include a restart requirement when one was reported, and SHALL offer a way to open the panel detail.

#### Scenario: Single update succeeds
- **WHEN** a single candidate is updated successfully
- **THEN** a notice states that it was updated and offers to open the detail

#### Scenario: Single update fails
- **WHEN** a single candidate fails
- **THEN** a notice states that it failed and offers to open the detail

#### Scenario: Batch mixed outcome
- **WHEN** a batch finishes with several outcomes
- **THEN** the notice states the counts by outcome and offers to open the detail

#### Scenario: Notice with the panel open
- **WHEN** an update settles while the panel is open
- **THEN** the notice still appears, and the settled row remains in the list

#### Scenario: Restart required
- **WHEN** a completed update requires a restart
- **THEN** the notice states the restart requirement in addition to the outcome
