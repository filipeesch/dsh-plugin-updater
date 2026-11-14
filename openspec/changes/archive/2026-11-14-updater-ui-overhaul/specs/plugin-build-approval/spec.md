# Spec Delta

## MODIFIED Requirements

### Requirement: Trust is granted per repository

The system SHALL maintain a list of trusted repositories identified by their host and repository path, and SHALL NOT grant trust by account, organization, or wildcard pattern. An entry SHALL cover only the repository it names. Trust SHALL be granted from the candidate row that names the repository, and the system SHALL NOT propose a batch of repositories for confirmation on first use.

#### Scenario: Trust one repository
- **WHEN** the user adds github.com/owner/repo to the trusted list
- **THEN** trust applies to that repository and no other, including other repositories of the same owner

#### Scenario: Another repository of the same owner is not trusted
- **WHEN** an update concerns a repository belonging to the same owner but not on the list
- **THEN** the system treats it as untrusted and asks before approving a build script

#### Scenario: Wildcard entry is rejected
- **WHEN** an entry would describe a pattern rather than one repository
- **THEN** the system refuses the entry and explains that trust is per repository

#### Scenario: Trust granted from the candidate row
- **WHEN** the user activates the trust action on a candidate whose repository is not trusted
- **THEN** exactly that repository is added to the trusted list

### Requirement: Untrusted repository asks without stopping the batch

When an untrusted repository requires a blocked build script, the system SHALL stop only that candidate, SHALL restore its previous state, and SHALL present the approval request on that candidate's row with actions to allow and install, to always allow the repository and install, and to decline. The remaining candidates in a batch SHALL still be processed. The request SHALL remain available after the row is rebuilt until the user decides.

#### Scenario: Untrusted repository in a batch
- **WHEN** an untrusted candidate needs build approval during a batch
- **THEN** that candidate is restored, the request is presented, and the other candidates continue

#### Scenario: Approving restores progress
- **WHEN** the user allows the pending build script
- **THEN** that candidate is installed with exactly the reported entries and the approval is remembered for the exact key

#### Scenario: Declining leaves the plugin working
- **WHEN** the user declines the approval
- **THEN** the previously installed version remains in place

#### Scenario: Request survives the reload
- **WHEN** the failed attempt returns and the row is rebuilt from the snapshot
- **THEN** the same request is still presented and still actionable

#### Scenario: Always allow from the request
- **WHEN** the user chooses to always allow the repository from the request
- **THEN** the repository is added to the trusted list and the candidate is installed

### Requirement: Approval is disclosed

Whenever the system approves a build script, automatically or after a user decision, it SHALL state which repository was trusted and which exact entry was added. The completed row SHALL keep that record available in its detail.

#### Scenario: Automatic approval reported
- **WHEN** a build script is approved automatically during an update
- **THEN** the outcome states the repository and the exact entry that was added

#### Scenario: Approval visible afterwards
- **WHEN** the user reviews a completed update that required approval
- **THEN** the record of that approval remains available in the row detail

#### Scenario: Decision shown in the row
- **WHEN** the user allows an approval request
- **THEN** the row states which entries were allowed for which repository

## REMOVED Requirements

### Requirement: First-use onboarding of the trusted list

**Reason**: Trust is now offered per candidate row, so a batch confirmation step on first use is redundant and can be ignored before any repository is actually needed.

**Migration**: The repositories previously proposed in the onboarding step are not trusted automatically. Each untrusted git candidate now offers its own trust action, and the settings tab still lists, adds, and removes trusted repositories. An existing trusted list is preserved unchanged.

## ADDED Requirements

### Requirement: Trust action on an untrusted git candidate

The system SHALL offer a trust action on every candidate row whose installation source is a git repository that is not in the trusted list. Activating it SHALL add exactly that repository. The system SHALL NOT offer the action for registry or local candidates, and SHALL NOT trust anything without the action.

#### Scenario: Action present on an untrusted row
- **WHEN** a git candidate's repository is not in the trusted list
- **THEN** its row offers the action to trust that repository

#### Scenario: Nothing trusted on first run
- **WHEN** the plugin runs for the first time with git-installed candidates
- **THEN** no repository is trusted and no batch confirmation is presented

#### Scenario: No action for a trusted row
- **WHEN** a git candidate's repository is already trusted
- **THEN** the row does not offer the trust action

#### Scenario: No action for registry or local rows
- **WHEN** a candidate is installed from the registry or from a local directory
- **THEN** its row does not offer a trust action
