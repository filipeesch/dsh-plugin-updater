# Spec Delta

## MODIFIED Requirements

### Requirement: Registry update detection

For a candidate installed from a registry spec under its own package name, the system SHALL obtain published versions newer than the installed version and SHALL report the newest one that declares a bundle and is compatible with the running DSH. The system SHALL follow the version list the plugin manager already reports rather than querying the registry itself, and SHALL keep the registry that answered that listing so the update can ask it first. When no newer published version declares a bundle and is compatible, the system SHALL report no available update for that candidate and SHALL state why.

#### Scenario: Newer registry version exists
- **WHEN** a registry candidate is installed at 0.3.2 and 0.3.4 is published
- **THEN** the system reports an available update to 0.3.4 with the installed version it replaces

#### Scenario: Installed version is the newest
- **WHEN** no published version is newer than the installed one
- **THEN** the system reports no update for that candidate

#### Scenario: Name collides with an unrelated registry package
- **WHEN** a candidate is installed from a git spec
- **THEN** the system never resolves it against the registry by name, regardless of whether a same-named registry package exists

#### Scenario: Every newer version is incompatible
- **WHEN** every published version newer than the installed one is incompatible with the running DSH
- **THEN** the system reports no available update for that candidate and states that no published version is compatible

#### Scenario: Newer version declares no bundle
- **WHEN** the newest published version newer than the installed one declares no bundle
- **THEN** the system does not offer it as an update

#### Scenario: Registry remembered for the update
- **WHEN** a later version is selected from a listing answered by a specific registry
- **THEN** that registry is carried with the candidate so the update asks it first
