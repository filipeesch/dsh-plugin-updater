# Spec Delta

## MODIFIED Requirements

### Requirement: Registry plugin update

For a registry candidate, the system SHALL delegate the update to the existing plugin manager update path, which validates compatibility with the running DSH version and restores the previous version if the new one fails. The system SHALL pass the registry that answered the candidate's version listing, so the update asks the same registry order that produced the offered version.

#### Scenario: Successful registry update
- **WHEN** the target version is compatible and installs
- **THEN** the candidate reports the new installed version

#### Scenario: Incompatible target version
- **WHEN** the target version requires a DSH version the user does not run
- **THEN** the update is refused, the installed version is unchanged, and the requirements that failed are reported

#### Scenario: Same registry as the listing
- **WHEN** detection found the available version through a registry
- **THEN** the update asks that registry first instead of silently starting from the configured default

### Requirement: Git plugin update

For a git candidate, the system SHALL first attempt to install the repository at HEAD over the installed package, without removing it. The system SHALL remove the installed package and install the repository at HEAD only when the Host refuses that attempt because the package is already installed. On success, the system SHALL leave the profile dependency spec unfixed so later detection still follows HEAD. The system SHALL NOT leave a pinned commit in the profile manifest after a completed attempt.

#### Scenario: Successful git update
- **WHEN** the Host accepts installing the repository at HEAD over the running package
- **THEN** the installed commit becomes the new HEAD and the saved dependency spec refers to the repository without a pinned commit

#### Scenario: Later detection after a git update
- **WHEN** a plugin was updated from git and the repository gains a new commit
- **THEN** detection reports the new commit as an available update

#### Scenario: Host refuses the install-over attempt
- **WHEN** the Host refuses the attempt because the package is already installed
- **THEN** the system removes the package, installs the repository at HEAD, and reports the update

#### Scenario: Install-over attempt fails for another reason
- **WHEN** the install-over attempt fails for any reason other than the package already being installed
- **THEN** the installed package is left untouched and the failure is reported with its diagnosis

### Requirement: Restoration after failure

When a git update fails or is cancelled after the installed package was removed, the system SHALL reinstall the previously installed commit and SHALL restore the profile manifest dependency spec to its original unfixed form.

#### Scenario: Installation of the target fails
- **WHEN** installing the repository at HEAD fails after the installed package was removed
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

#### Scenario: Failure before any removal
- **WHEN** the attempt fails before the installed package was removed
- **THEN** nothing is reinstalled, the installed package keeps running, and the outcome states that the previous state was untouched

### Requirement: Update failure explanation

When an update fails, the system SHALL report the Host's own failure code and diagnostic text, SHALL keep the package manager output the failed attempt produced, and SHALL state whether the previous state was restored. The system SHALL NOT replace the Host's explanation with a generic sentence. When the failed attempt left the previously installed version running, the outcome SHALL state that the installed version was left in place, and when a reinstallation was attempted and failed, the outcome SHALL report both failures and name the spec to reinstall.

#### Scenario: Incompatibility failure
- **WHEN** the target version requires a DSH version the user does not run
- **THEN** the system reports the Host's failure code and the required and running DSH versions

#### Scenario: Blocked build script failure
- **WHEN** a git-installed candidate's target requires an unapproved build script
- **THEN** the system names the exact approval needed and offers to trust that repository

#### Scenario: Blocked build script on a registry candidate
- **WHEN** a registry candidate's target requires an unapproved build script
- **THEN** the system reports the failure code and diagnostic and states that the approval must be granted in the application's own installation dialog

#### Scenario: Network failure
- **WHEN** the target cannot be downloaded
- **THEN** the system reports the failure code and the download diagnostic and states that the previous state was restored

#### Scenario: Failure carries package manager output
- **WHEN** the failed attempt produced package manager output
- **THEN** that output remains available for the failed row

#### Scenario: Host reports no diagnostic text
- **WHEN** the Host reports a failure without diagnostic text
- **THEN** the failure code is stated as the reason and the package manager output is offered instead

#### Scenario: Recovery failed
- **WHEN** the reinstallation after a failed git update fails as well
- **THEN** the outcome is reported as a failure, naming both the target failure and the reinstallation failure and the spec to install to recover
