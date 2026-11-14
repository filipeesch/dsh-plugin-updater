# Spec Delta

## MODIFIED Requirements

### Requirement: Detection schedule

The system SHALL run detection asynchronously at user-interface start and then at a fixed interval of 60 minutes, and SHALL support a manual check that starts a detection immediately. Detection SHALL NOT block rendering of the interface. A profile change caused by this plugin's own update SHALL NOT start a detection.

#### Scenario: Check at interface start
- **WHEN** the interface starts
- **THEN** a detection begins without delaying the render

#### Scenario: Periodic check
- **WHEN** 60 minutes have passed since the last successful detection while the interface remains open
- **THEN** a new detection begins

#### Scenario: Manual check
- **WHEN** the user activates the refresh control
- **THEN** a detection begins immediately regardless of the interval

#### Scenario: Concurrent activation
- **WHEN** a detection is already running and another is requested
- **THEN** the system does not start a second concurrent detection

#### Scenario: Profile change after an update
- **WHEN** an update started from the panel changes the profile
- **THEN** the panel refreshes its snapshot without starting a new detection

## ADDED Requirements

### Requirement: Per-candidate re-check

The system SHALL let the user re-check one candidate whose check failed, without running detection for the other candidates. A successful re-check SHALL clear that candidate's failure and record its new result. A failed re-check SHALL keep that candidate reported as not checked with the new reason. A per-candidate re-check SHALL NOT run concurrently with a running detection.

#### Scenario: Re-check one candidate
- **WHEN** the user activates the retry action on a failed candidate
- **THEN** only that candidate is checked again

#### Scenario: Other candidates unchanged
- **WHEN** a single candidate is re-checked
- **THEN** the other candidates keep their previous results and their displayed state

#### Scenario: Successful re-check
- **WHEN** the re-check reaches the candidate
- **THEN** its failure is cleared and its current result is shown

#### Scenario: Failed re-check
- **WHEN** the re-check fails again
- **THEN** the candidate remains reported as not checked with the new reason

#### Scenario: Detection already running
- **WHEN** a full detection is running and the user asks to re-check one candidate
- **THEN** a second detection is not started, and the candidate is re-checked when the running detection is not using the same check
