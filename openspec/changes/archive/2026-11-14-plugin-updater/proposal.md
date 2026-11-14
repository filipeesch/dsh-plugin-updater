# Proposal

## Why

DeepSeek Harness can update a plugin only when it is a third-party package installed from a registry under its own name. Every plugin installed from a GitHub spec, and every plugin installed from a local directory, has no update path in the GUI at all. Four of the six third-party plugins in the reference profile are git specs, so the majority of installed plugins cannot be updated without hand-editing `package.json` and running pnpm.

Two secondary problems make the gap worse. Git-hosted plugins that declare a build script need an `allowBuilds` entry whose key contains the resolved commit, so every new commit requires a fresh approval and stale keys accumulate in the profile settings. And because four of these plugins share a name with an unrelated package on npm, resolving a git-installed plugin by name against the registry would silently substitute a stranger's code.

## What Changes

- A new sidebar footer item, above Settings, showing how many plugins have pending work and offering a one-click refresh.
- A new main panel with two tabs: a list of pending updates and reloads, and settings for trusted repositories and ignored versions.
- Update detection for registry plugins, which delegates to the existing `pluginManager.updateBundle`, and for git plugins, which compares the installed commit from the pnpm lockfile with the repository HEAD plus the `package.json` version at that HEAD.
- Commit-message release notes for git plugins, read from a blobless clone cache with a bounded size.
- A git update path built on the existing `removeBundle` and `installBundle` methods, with automatic restoration of the previous commit on failure and no commit pinned in the profile manifest afterwards.
- Automatic resolution of blocked build scripts for repositories the user has marked trusted, with an in-place approval prompt for everyone else that does not stop the rest of a batch.
- Reload for plugins installed from a local directory, offered only when their files are newer than the running Host.
- A periodic background check plus a manual refresh, both asynchronous.

No existing DSH package is modified. The plugin contributes through the sidebar footer action slot, the main panel slot, and the existing plugin manager Remote methods.

## Capabilities

### New Capabilities

- `plugin-update-detection`: which installed packages are update candidates, how a newer version is identified for registry and git installs, how release notes are obtained, and when detection runs.
- `plugin-update-application`: applying an update to a registry or git plugin, restoring the previous state on failure, cancelling, reloading a local plugin, and signalling that a restart is required.
- `plugin-updates-sidebar-entry`: the footer item, its count, its refresh control, and its appearance in the expanded and collapsed sidebar.
- `plugin-updates-panel`: the Updates and Settings tabs, the per-plugin rows, release notes, and how a mixed batch result is reported.
- `plugin-build-approval`: the trusted repository list, automatic approval of blocked build scripts for trusted repositories, and the in-place approval flow for everyone else.

### Modified Capabilities

None. The project has no existing specs, and no DSH capability contract changes.

## Impact

- New package `dsh-plugin-updater`, plain ESM with no build step, installed by GitHub spec.
- Consumes, without modifying: `pluginManager.listBundles`, `listVersions`, `updateBundle`, `installBundle`, `removeBundle`, `cancelInstall`, and the `plugin-manager/changed`, `install-log`, `install-state`, and `update-state` events.
- Adds a sidebar footer action and a main panel; registers no new Remote namespace of its own beyond its Host-to-Client bridge.
- Reads the profile `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`; writes only its own plugin configuration, and writes `pnpm-workspace.yaml` only to add an exact `allowBuilds` key.
- Keeps a bounded clone cache in the user data directory.
- Not published to npm: the package name is already taken by an unrelated project, so `private` is set and the package installs only from git.
