# plugin-update-application Specification

## Purpose
Applies an available update to a plugin, whatever its installation source, while guaranteeing that a failed or cancelled attempt leaves the plugin in its previous working state, and reports honestly when the running Host is still executing the previous code.

## Requirements

### Requirement: Updates are user-initiated

The system SHALL start an update only in response to an explicit user action. Detection SHALL never apply an update on its own.

#### Scenario: Detection finds an update
- **WHEN** detection reports an available update
- **THEN** no update is applied until the user activates the update action for it

#### Scenario: Batch update
- **WHEN** the user activates the update action for all pending candidates
- **THEN** every pending candidate is updated without further confirmation per candidate

### Requirement: Registry plugin update

For a registry candidate, the system SHALL delegate the update to the existing plugin manager update path, which validates compatibility with the running DSH version and restores the previous version if the new one fails.

#### Scenario: Successful registry update
- **WHEN** the target version is compatible and installs
- **THEN** the candidate reports the new installed version

#### Scenario: Incompatible target version
- **WHEN** the target version requires a DSH version the user does not run
- **THEN** the update is refused, the installed version is unchanged, and the requirements that failed are reported

### Requirement: Git plugin update

For a git candidate, the system SHALL remove the installed package, install the repository at HEAD, and on success leave the profile dependency spec unfixed so later detection still follows HEAD. The system SHALL NOT leave a pinned commit in the profile manifest after a completed attempt.

#### Scenario: Successful git update
- **WHEN** the repository HEAD installs successfully
- **THEN** the installed commit becomes the new HEAD and the saved dependency spec refers to the repository without a pinned commit

#### Scenario: Later detection after a git update
- **WHEN** a plugin was updated from git and the repository gains a new commit
- **THEN** detection reports the new commit as an available update

### Requirement: Restoration after failure

When a git update fails or is cancelled after the installed package was removed, the system SHALL reinstall the previously installed commit and SHALL restore the profile manifest dependency spec to its original unfixed form.

#### Scenario: Installation of the target fails
- **WHEN** installing the repository at HEAD fails
- **THEN** the previously installed commit is reinstalled and the plugin remains available

#### Scenario: Restoration also fails
- **WHEN** reinstalling the previously installed commit fails
- **THEN** the system reports both failures and names the exact spec the user can install to recover

#### Scenario: Cancellation after removal
- **WHEN** the user cancels after the installed package was removed
- **THEN** the previously installed commit is reinstalled before the operation reports completion

#### Scenario: Profile manifest after a failed update
- **WHEN** an update fails and is restored
- **THEN** the saved dependency spec equals what it was before the update began

### Requirement: Cancellation

The system SHALL allow cancelling a running update at any point. Cancelling during a batch SHALL abandon the remaining queue, leaving those candidates untouched.

#### Scenario: Cancel a single update
- **WHEN** the user cancels the update of one candidate
- **THEN** that candidate returns to its previous state and the operation reports cancellation

#### Scenario: Cancel during a batch
- **WHEN** the user cancels while a batch is running
- **THEN** the current candidate is restored and no further candidate in the queue is started

#### Scenario: Restart required after success
- **WHEN** the plugin manager reports that a completed update takes effect only at the next start
- **THEN** the system reports the need to restart and does not attempt to restart the Host itself

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

### Requirement: Local plugin reload

For a plugin installed from a local directory, the system SHALL offer a reload rather than an update, and SHALL offer it only while the plugin's files are newer than the running Host. Reloading SHALL NOT reinstall the package.

#### Scenario: Local files changed after Host start
- **WHEN** a file of a local plugin was modified after the Host started
- **THEN** the system offers a reload for that plugin

#### Scenario: Local files unchanged
- **WHEN** no file of a local plugin changed since the Host started
- **THEN** the system offers no reload for that plugin

#### Scenario: Reload applied
- **WHEN** the user reloads a local plugin
- **THEN** the plugin runs the code currently in its directory

### Requirement: Restart reporting

The system SHALL report that a restart is required only when the plugin manager reports that outcome for a completed change, and SHALL keep that notice visible until the user restarts.

#### Scenario: Change applies immediately
- **WHEN** a completed update applies without requiring a restart
- **THEN** the system does not report a restart to the user

#### Scenario: Restart required
- **WHEN** a completed update takes effect only at the next start
- **THEN** the system reports the restart requirement in the panel and in the completion notice

#### Scenario: Notice after the transient message is gone
- **WHEN** the restart requirement was reported and the transient message disappeared
- **THEN** the panel still shows the outstanding restart requirement

### Requirement: Update failure explanation

When an update fails, the system SHALL report the reason in terms the user can act on, and SHALL state whether the previous state was restored.

#### Scenario: Incompatibility failure
- **WHEN** the target version requires a DSH version the user does not run
- **THEN** the system reports the required and the running DSH versions

#### Scenario: Blocked build script failure
- **WHEN** the target version requires an unapproved build script
- **THEN** the system names the exact approval needed and offers to trust that repository

#### Scenario: Network failure
- **WHEN** the target cannot be downloaded
- **THEN** the system reports the download failure and that the previous state was restored

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
