# Spec Delta

## Purpose

Lets the user grant standing build-script approval to specific repositories they installed from, so that a git plugin which compiles can be updated without a manual approval every time its commit changes, while every other repository still requires an explicit decision.

## ADDED Requirements

### Requirement: Trust is granted per repository

The system SHALL maintain a list of trusted repositories identified by their host and repository path, and SHALL NOT grant trust by account, organization, or wildcard pattern. An entry SHALL cover only the repository it names.

#### Scenario: Trust one repository
- **WHEN** the user adds `github.com/owner/repo` to the trusted list
- **THEN** trust applies to that repository and no other, including other repositories of the same owner

#### Scenario: Another repository of the same owner is not trusted
- **WHEN** an update concerns a repository belonging to the same owner but not on the list
- **THEN** the system treats it as untrusted and asks before approving a build script

#### Scenario: Wildcard entry is rejected
- **WHEN** an entry would describe a pattern rather than one repository
- **THEN** the system refuses the entry and explains that trust is per repository

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

When an untrusted repository requires a blocked build script, the system SHALL stop only that candidate, SHALL restore its previous state, and SHALL present the approval request where the user is already looking. The remaining candidates in a batch SHALL still be processed.

#### Scenario: Untrusted repository in a batch
- **WHEN** an untrusted candidate needs build approval during a batch
- **THEN** that candidate is restored, the request is presented, and the other candidates continue

#### Scenario: Approving restores progress
- **WHEN** the user approves the pending build script
- **THEN** that candidate can be updated again and the approval is remembered for the exact key

#### Scenario: Declining leaves the plugin working
- **WHEN** the user declines the approval
- **THEN** the previously installed version remains in place

### Requirement: First-use onboarding of the trusted list

On first use the system SHALL propose, in a confirmation step, the repositories of the plugins currently installed from git, and SHALL apply nothing until the user confirms. Entries the user removes in that step SHALL NOT be trusted.

#### Scenario: First use proposes installed repositories
- **WHEN** the plugin runs for the first time and git-installed candidates exist
- **THEN** the system presents their repositories for confirmation before any of them is trusted

#### Scenario: Confirmed entries persist
- **WHEN** the user confirms the proposal
- **THEN** the confirmed repositories are trusted for this and later updates

#### Scenario: Removed entry is not trusted
- **WHEN** the user removes a proposed entry before confirming
- **THEN** that repository is not trusted and later needs approval

#### Scenario: No git candidates on first use
- **WHEN** the plugin runs for the first time and no candidate is installed from git
- **THEN** the system trusts nothing and asks for no confirmation

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

Whenever the system approves a build script automatically, it SHALL state which repository was trusted and which exact entry was added.

#### Scenario: Automatic approval reported
- **WHEN** a build script is approved automatically during an update
- **THEN** the outcome states the repository and the exact entry that was added

#### Scenario: Approval visible afterwards
- **WHEN** the user reviews a completed update that required automatic approval
- **THEN** the record of that approval remains available in the row detail
