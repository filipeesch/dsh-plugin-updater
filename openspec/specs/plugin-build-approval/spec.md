# plugin-build-approval Specification

## Purpose
Lets the user grant standing build-script approval to specific repositories they installed from, so that a git plugin which compiles can be updated without a manual approval every time its commit changes, while every other repository still requires an explicit decision.

## Requirements

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

### Requirement: Exact approval key only

When a trusted repository requires a blocked build script, the system SHALL add the exact approval entry the package manager reported and SHALL NOT add a wildcard, an account-level, or a broader rule.

#### Scenario: Exact key added
- **WHEN** a trusted repository's installation reports a blocked build script naming a specific package and resolved commit
- **THEN** the system adds exactly that entry and retries the installation

#### Scenario: Nothing broader added
- **WHEN** the system approves a build script
- **THEN** it adds no rule covering other packages or other commits

#### Scenario: Credential never recorded
- **WHEN** the reported approval key would contain a credential
- **THEN** the system does not record it and reports the situation instead

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

### Requirement: Trust persists and is revocable

Trusted repositories SHALL persist across restarts and SHALL be revocable, and revoking one SHALL restore the requirement for explicit approval for that repository.

#### Scenario: Trust survives a restart
- **WHEN** the Host restarts after a repository was trusted
- **THEN** that repository is still trusted

#### Scenario: Revoking trust
- **WHEN** the user removes a repository from the trusted list
- **THEN** its next build-script requirement asks for approval instead of proceeding

### Requirement: Scope limited to this plugin's own updates

Approval granted here SHALL apply only to operations this plugin performs, and SHALL NOT alter how installations started elsewhere in the application are approved.

#### Scenario: Install started in the plugin manager
- **WHEN** the user installs a plugin through the application's own installation dialog
- **THEN** the approval behavior of that installation is unchanged by the trusted list

#### Scenario: Update started by this plugin
- **WHEN** this plugin runs an update for a trusted repository
- **THEN** the trusted list applies to that update

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
