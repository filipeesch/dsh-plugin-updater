# Spec Delta

## Purpose

Decides which installed packages can be updated, determines whether a newer version exists for registry and git installs alike, obtains the release notes that explain what changed, and states when detection runs.

## ADDED Requirements

### Requirement: Update candidates

The system SHALL treat a direct dependency of the profile as an update candidate only when its package manifest declares `dsh.bundle`. Packages the DSH installation itself provides SHALL be excluded.

#### Scenario: Third-party bundle is a candidate
- **WHEN** the profile lists `dsh-kanban` as a direct dependency and its manifest declares `dsh.bundle`
- **THEN** the system lists `dsh-kanban` as a candidate

#### Scenario: Plain dependency is not a candidate
- **WHEN** the profile lists a direct dependency whose manifest declares no `dsh.bundle`
- **THEN** the system does not list it as a candidate

#### Scenario: Transitive dependency is not a candidate
- **WHEN** a package appears in the lockfile but not as a direct dependency of the profile
- **THEN** the system does not list it as a candidate

#### Scenario: Installation-provided bundle is not a candidate
- **WHEN** a candidate name is also provided by the DSH installation
- **THEN** the system does not offer an update for it

### Requirement: Registry update detection

For a candidate installed from a registry spec under its own package name, the system SHALL obtain published versions newer than the installed version and SHALL report the newest one that declares `dsh.bundle`. The system SHALL follow the version list the plugin manager already reports rather than querying the registry itself.

#### Scenario: Newer registry version exists
- **WHEN** a registry candidate is installed at 0.3.2 and 0.3.4 is published
- **THEN** the system reports an available update to 0.3.4 with the installed version it replaces

#### Scenario: Installed version is the newest
- **WHEN** no published version is newer than the installed one
- **THEN** the system reports no update for that candidate

#### Scenario: Name collides with an unrelated registry package
- **WHEN** a candidate is installed from a git spec
- **THEN** the system never resolves it against the registry by name, regardless of whether a same-named registry package exists

### Requirement: Git update detection

For a candidate installed from a git spec, the system SHALL read the installed commit from the profile lockfile and the repository HEAD from the remote, and SHALL report an update when they differ. The system SHALL report the package version declared by the repository at HEAD alongside the installed version.

#### Scenario: Repository HEAD moved
- **WHEN** the installed commit is `a39fef7` and the repository HEAD is `7bfa1f9`
- **THEN** the system reports an update, showing the version at HEAD against the installed version

#### Scenario: Installed commit is HEAD
- **WHEN** the installed commit equals the repository HEAD
- **THEN** the system reports no update for that candidate

#### Scenario: Version unchanged while commit moved
- **WHEN** the repository HEAD differs from the installed commit but the version at HEAD equals the installed version
- **THEN** the system reports the update as a commit count rather than as a version change

#### Scenario: Repository is unreachable
- **WHEN** the repository cannot be read, does not exist, or has become private
- **THEN** the system reports that candidate as not checked, without reporting an update or a failure for other candidates

### Requirement: Release notes

The system SHALL obtain the commit messages between the installed commit and the repository HEAD for a git candidate, using a locally cached partial clone, and SHALL present them in full with scrolling. The cache SHALL be bounded in size and SHALL evict the least recently used repository when the bound is reached.

#### Scenario: Notes for a git update
- **WHEN** a git candidate has commits between the installed commit and HEAD
- **THEN** the system shows those commit messages with their short commit identifier

#### Scenario: Notes for a registry update
- **WHEN** a candidate is installed from the registry and the release notes are unavailable
- **THEN** the system states that no notes were found without failing the update check

#### Scenario: Cache bound reached
- **WHEN** adding a repository would exceed the configured cache size
- **THEN** the system removes the least recently used repository before fetching

#### Scenario: Notes unavailable without network
- **WHEN** the clone cannot be fetched
- **THEN** the system reports the update without notes and states why the notes are missing

### Requirement: Detection schedule

The system SHALL run detection asynchronously at user-interface start and then at a fixed interval of 60 minutes, and SHALL support a manual check that starts a detection immediately. Detection SHALL NOT block rendering of the interface.

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

### Requirement: Detection failure reporting

When detection fails, the system SHALL retain the previously detected counts, SHALL mark them as not current, and SHALL distinguish a failure to check from a state of no pending updates.

#### Scenario: Network failure after a successful check
- **WHEN** a detection fails after a previous successful detection
- **THEN** the system keeps the previous counts and marks them as not current

#### Scenario: Failure before any successful check
- **WHEN** detection fails and no successful detection has occurred
- **THEN** the system reports that the state is unknown rather than reporting zero updates

#### Scenario: Recovery
- **WHEN** a detection succeeds after failures
- **THEN** the system clears the not-current marking and reports the new counts

### Requirement: Ignored updates

The system SHALL let the user ignore a specific update. For a git candidate the ignored identity SHALL be the commit, and for a registry candidate it SHALL be the version. An ignored update SHALL NOT count toward the pending total, SHALL remain visible in a collapsed section, and SHALL become pending again when a different commit or version appears.

#### Scenario: Ignoring a version
- **WHEN** the user ignores version 0.35.0 of a candidate
- **THEN** that update stops counting toward the pending total

#### Scenario: A newer version appears after ignoring
- **WHEN** a candidate has an ignored version and a newer version later appears
- **THEN** the newer version counts toward the pending total

#### Scenario: A new commit with the ignored version
- **WHEN** a git candidate has an ignored commit and the repository gains another commit still declaring the same version
- **THEN** the new commit counts toward the pending total
