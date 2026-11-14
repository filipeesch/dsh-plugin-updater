# Plugin Updater

One-click updates for the plugins installed in a DeepSeek Harness profile, including plugins installed from GitHub and plugins installed from a local directory.

DeepSeek Harness can already update a plugin that is a third-party package installed from a registry under its own name. It offers no update path for a plugin installed from a git spec or from a local directory. Plugin Updater covers that gap without changing any DeepSeek Harness package: it adds one entry above Settings in the sidebar and one panel with two tabs.

## Install

```
dsh plugin --profile <name> add github:filipeesch/dsh-plugin-updater
```

Or add the dependency to the profile and select the bundle:

```json
{ "dependencies": { "dsh-plugin-updater": "github:filipeesch/dsh-plugin-updater" } }
```

**Install from GitHub only.** The npm name `dsh-plugin-updater` belongs to an unrelated project, so `private` is set in the package manifest and this package is never published. Installing it by name from a registry would fetch that other project. There is no build step, so installing it needs no build-script approval.

## What it does

- Detects available updates for registry plugins and for git plugins. A git plugin is current when its installed commit equals the repository HEAD; the displayed version is the one the repository declares at HEAD.
- Shows release notes for a git update, read from the commits between the installed commit and HEAD.
- Updates a git plugin by removing and reinstalling it, and restores the previous commit if the attempt fails or is cancelled. The saved dependency spec is left unpinned, so later detection keeps following HEAD.
- Offers a reload, rather than an update, for a plugin installed from a local directory, and only while its files are newer than the running application.
- Approves build scripts automatically only for repositories you mark as trusted; anything else asks first.
- Checks on start and every 60 minutes, in the background, and offers a manual refresh.

## Where it appears

One entry in the sidebar footer, above Settings. It shows how many plugins need attention, including plugins awaiting a reload and plugins whose check failed. The count opens the panel; the refresh control beside it starts a check without opening anything.

## Configuration

Both lists live in the Settings tab of the panel, stored in the plugin configuration:

- **Trusted repositories**: `host/owner/repo` entries. Trust is per repository, never per account, and a wildcard is refused. Approving a build script writes only the exact key the package manager reported.
- **Ignored updates**: an ignored git update is identified by its commit and an ignored registry update by its version, so a later, different update is reported again.

On first use, the repositories of the plugins currently installed from git are proposed for confirmation. Nothing is trusted until you confirm.

## Limitations

- It does not update DeepSeek Harness itself.
- It does not install new plugins; use the application's own installation dialog for that.
- The periodic check advances only while the interface is open. Opening the interface always triggers a check.
- Replacing a git plugin removes it before installing the new commit, so the plugin is briefly absent. The previous commit is restored if the installation fails.
- Release notes need a local clone of the repository, kept in a cache of at most 100 MB. A repository larger than that is fetched again on each check.
- It registers no agent tool; every operation is a user action.

## Requirements

- DeepSeek Harness `>=0.2.2-rc.1 <0.3.0-0`
- Node.js `>=22.19.0`
- `git` on `PATH` for git-installed plugins, and `pnpm` as the profile's package manager

## Development

Install the test-only peer first, then run the suite:

    npm install
    npm test

That install is for the tests alone: the plugin has no runtime dependency and
needs no build step. Without it, the tests that load the browser bundle skip
rather than fail, because zod is supplied by the host profile at runtime.

## License

MIT
