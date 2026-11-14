# Design

## Context

The DSH plugin manager already owns profile mutation: it installs, removes, enables, and reloads bundles, it validates DSH compatibility, it restores `package.json` and `pnpm-lock.yaml` when an install fails, and it chooses the git transport. Its update path is narrower than its install path: `updateBundle` refuses any candidate that is not a registry spec whose name matches the package name, which excludes every git spec and every local path.

Several constraints come from the host rather than from this feature:

- A sidebar panel-list row renders only a decorative glyph. The glyph sits inside the button that selects the panel, and the label is a string the shell resolves. There is no slot for a per-row action.
- A sidebar **footer action** is a list slot rendered above Settings with `width: 100%`, whose contents the registrant owns entirely. That is the only sidebar position where a row with a control of our own can live.
- A main panel is selected by key and rendered by the layout from the `main` slot; selecting one requires a matching `main` entry, not a panel-list entry. So a footer button can open a panel without registering a list row.
- Plugin `Config` is schemastery and is the documented place for user-adjustable values; `configEditor` writes it without the plugin touching the profile patch file.
- Host-to-Client calls use generated Typert contributions. A plain-JS plugin can build that contribution by hand, because `@deepseek-ai/dsh-typert-protocol` and `zod` resolve from the profile; `dsh-kanban` does exactly this.
- HMR is present whenever a profile context exists, so the remove-then-install path for replacing a package is available in both the web and desktop profiles.
- An unauthenticated GitHub API allows 60 requests per hour, which is too few for a 60-minute poll over several repositories, while `git ls-remote` has no such budget.

Observed facts about the reference profile that shaped the decisions:

- Git specs are saved without a commit (`github:owner/repo`), and the installed commit appears only in the lockfile as `.../tar.gz/<sha>`.
- Repository names and package names differ (`deepseek-harness-kanban` provides `dsh-kanban`), and two of four installed plugins declare no `repository` field while one declares a different repository than the one it was installed from. The saved dependency spec is therefore the only trustworthy source of the repository.
- Repository tags and GitHub Releases lag far behind the code (`dsh-kanban` publishes `v0.15.0` while its manifest declares `0.35.0`), and no installed plugin ships a changelog.
- `allowBuilds` keys embed the resolved commit, so every new commit creates a new key; the reference profile had accumulated 31 keys of which 29 referred to commits that no longer existed.

See `proposal.md` — Why for the motivation and `specs/` for the required behavior.

## Goals / Non-Goals

**Goals:**

- Give git-installed and local plugins a first-class update path in the GUI without changing any DSH package.
- Reuse the plugin manager's existing mutation, compatibility, and restoration machinery rather than reimplementing package management.
- Keep the profile manifest in a state where later detection still follows HEAD.
- Make build-script approval for trusted repositories automatic yet narrow and disclosed.
- Keep the interface responsive: detection is asynchronous, never blocking a render.

**Non-Goals:**

- Updating DSH itself. The application has its own update mechanism.
- Installing new plugins. The application's installation dialog owns that flow.
- Exposing any operation as an agent tool.
- Publishing to npm. The package name belongs to an unrelated project.
- A TypeScript build pipeline. The plugin ships plain ESM.

## Decisions

### Compose updates from the plugin manager's existing methods

A registry update delegates to `pluginManager.updateBundle`. A git update performs `removeBundle` followed by `installBundle` with a spec pinned to the target commit. Local plugins use the existing reload path.

**Why:** `updateBundle` already validates the target against `evaluatePluginCompatibility` and reinstalls the previous version when the new one fails; `installBundle` restores the profile files on failure and streams package manager output under a request id. Reimplementing any of that would duplicate restoration logic that is easy to get subtly wrong.

**Alternative rejected:** driving pnpm directly. It would bypass compatibility checks, the GitHub connection preflight, the SSH transport probe, and the file restoration contract.

### Candidate selection uses the host's own inventory

A candidate is a direct profile dependency whose installed manifest declares `dsh.bundle`, and never a bundle the Harness installation supplies.

**Why the second clause needs the host:** whether a package ships with the application is not visible in the profile. The plugin manager answers it, reporting `BundleInfo.availability === 'installation'` for a package present in the installation anchor, so the plugin asks `listBundles()` instead of inferring anything from names. Reading the inventory is best-effort: a Host without that method excludes nothing rather than failing a check.

**Cost:** one `listBundles()` per Host start, cached in memory, because the installation cannot change while the process runs.

### Never resolve a git candidate by name

A git candidate keeps its git spec throughout. Detection reads the repository from the saved dependency spec, never from the manifest's `repository` field and never from the registry.

**Why:** four packages in the reference profile share a name with an unrelated registry package, and one plugin's manifest declares a different repository than the one it was installed from. Resolving by name would silently substitute unrelated code. This also makes the "same name, different repository" case impossible by construction rather than by a check.

### Detect git updates by commit, describe them by version

An update exists when the lockfile commit differs from `git ls-remote` HEAD. The displayed identity is the `version` declared by the repository's `package.json` at HEAD, and when that version equals the installed one the row shows the commit count instead.

**Why:** tags and releases do not track the code in these repositories, so a version-only comparison would report "current" for a repository that had moved. Showing a count when the version did not move keeps two different updates from looking identical.

**Cost:** one `git ls-remote` (~1.5 s measured) plus one raw `package.json` per git candidate, per check. Four candidates finish in roughly 1.6 s when run in parallel.

### Read release notes from a blobless clone cache, not the GitHub API

Commit messages come from `git log <installed>..HEAD` in a bare clone fetched with `--filter=blob:none`, kept in a cache directory with a 100 MB bound and LRU eviction.

**Why:** the unauthenticated API budget (60/h) is too small for polling, and an authenticated token would add a credential the plugin does not otherwise need. Git reuses the machine's existing credentials, so private repositories work, and a blobless clone transfers commits and trees only.

**Alternative rejected:** the compare endpoint. It costs a request per candidate per check and still needs a token for private repositories.

**Cost:** the first check of each repository downloads a clone; later checks fetch incrementally. When the bound evicts a repository, its next check downloads again.

### Restore by pinning temporarily, then unfixing

The git update installs a spec pinned to a commit so removal and replacement address an exact revision, and after the attempt settles — success or restoration — the saved dependency spec is rewritten to its original unfixed form.

**Why:** without the final rewrite, the first failure would leave the manifest pinned to a commit, and detection would then compare that pinned commit against itself and report "current" forever. That failure is silent and permanent, which is worse than a visible error.

**Constraint:** the rewrite must also happen when restoring, not only on success, or a single restored update reproduces the bug.

### Local plugins reload rather than install

A local plugin is installed as a symlink to its directory, so its code is already current; what lags is the module the Host loaded. Reload is offered only when a file of the plugin is newer than the Host's start time.

**Why:** measured behavior — changing the version in the source directory was visible through `node_modules` immediately without reinstalling. Offering "update" would reinstall identical code. Comparing file mtimes against Host start is objective and needs no action from the user, unlike comparing a version the user would have to bump by hand.

**Risk:** a file touched without a content change still triggers the offer. Accepted: a reload is cheap and the false positive is harmless.

### Sidebar entry lives in the footer, not the panel list

The plugin contributes one `sidebar.footer.action` entry and no `sidebar.panellist` entry.

**Why:** the footer slot is the only sidebar position whose contents the registrant owns completely, which is what allows icon, label, right-aligned count, and refresh control on one row. The panel-list row exposes only a decorative glyph, and a glyph cannot host a clickable control because it renders inside the row's own button. A nested button is invalid HTML and would open the panel on click.

**Consequence:** the entry is permanent — it cannot be unpinned and does not appear in the panels overflow menu, like Settings.

**Alternative rejected:** shadowing the Plugins row at a lower priority to draw a badge there. It would require reproducing the host icon by hand (client packages cannot be imported by a plugin), and it would visually change a host-owned entry rather than add a plugin-owned one.

### Count aggregates all three pending kinds

The count includes available updates, pending reloads, and failed checks, and shows `9+` above nine on the collapsed rail.

**Why:** the number answers "does anything need me", so a zero that hides a pending reload or a failed check would be misleading. A failed check is also shown as its own small pill on the row so the count does not imply three installable updates when one is a broken repository.

### Trusted repositories are per repository and exact

Trust entries are `host/path` repository identities. Approval writes exactly the key the package manager reported. On first use the repositories of currently installed git plugins are proposed for confirmation.

**Why:** an account-level rule would grant standing execution rights to code the user never installed. Per-repository trust matches the decision the user actually made when installing, and the exact key avoids a wildcard that would cover future packages.

**Identity, not text:** the match parses the source URL and compares host and path for equality. A substring or prefix test is not a narrower version of this rule, it is a different and unsafe one: `o/safe-but-malicious`, `o/safe2`, a project nested under a trusted path, and a foreign host whose path merely mentions the trusted identity all match a substring, and each of them would run a third party's build script without asking. The archive host is also not the repository host — GitHub serves git dependencies from `codeload.github.com` — so the source is mapped back to the host the user trusted before comparing.

**Constraint:** trust applies only to operations this plugin runs. Installations started from the application's own dialog are unaffected because this plugin does not participate in them.

### Configuration in plugin Config, not a bespoke file

Trusted repositories and ignored updates live in the plugin's `Config`, written through `configEditor`; detection results and the restart notice live in memory only.

**Why:** the host documents `Config` as the place for user-adjustable values, it survives upgrades in the user's patch layer, and it is rendered by the existing settings UI. A JSON file in the home directory would be a second configuration mechanism with its own validation problems — the previous updater in this profile did that and left orphaned state behind.

### Plain-JS bridge, no build step

`index.js` and `client.js` sit at the package root with internal modules in `src/`. The Host-to-Client contract is a hand-written Remote contribution: the descriptor factory is written out in `src/remote.js` rather than imported.

**Why:** a build step would require approving this plugin's own build script during its first installation, and the trusted list that could approve it does not exist until the plugin runs — a circularity. Plain ESM installs from a GitHub spec with no approval at all.

**Why the factory is copied rather than imported:** verified against the live profile, the protocol version resolved there (`0.2.0-rc.2`) does not export `createTypertRemoteInfo`, and its `./remote-info` subpath is not exported either. An installed third-party plugin that faces the same problem carries its own copy of the factory for the same reason. The copy is about 150 lines, has no dependencies beyond `zod`, and produces the descriptor shape the gateway consumes: `id`, namespace and method split from the endpoint, per-parameter wire name and codec, a result codec, and a named-input parser that also projects JSON Schema.

**Verified:** loading the built contribution in the live profile yields seven descriptors, the expected namespace and method names, and a strict input parser that accepts `{ request: {} }` for a no-argument method and rejects an undeclared field.

**Constraint:** no type checking at build time, so pure logic is covered by `node --test` and every file is syntax-checked before commit.

### Detection scheduling

Detection runs once when the client starts and every 60 minutes thereafter, coalescing concurrent requests so one cycle runs at a time.

**Why:** the interval is a build-time constant because the refresh control already covers the impatient case, and every configurable field is a chance to misconfigure. Coalescing prevents a manual refresh from stacking a second pass on a running one.

**Limitation:** the interval only advances while the interface is open. Opening the interface after it was closed always triggers a check.

## Risks / Trade-offs

- **Two-step git update has a window where the plugin is absent.** `removeBundle` then `installBundle` cannot be made atomic, and `removeBundle` does not accept a cancellation signal, so there is a period where the package is gone and uninterruptible. → Restoration installs the previous commit; the operation reports both outcomes when restoration also fails, naming the exact spec to reinstall.
- **The footer row's reserved space is not a documented contract.** The footer container is `width: 100%` flex today, but a host change could restyle it. → The row lays out with its own flex rules inside whatever width it receives, and degrades to icon-only rather than overflowing.
- **Commit-count release notes grow unbounded.** Ten commits read well; two hundred do not. → Notes scroll within the row as required by the spec, and the row states the total count so the user knows the size before expanding.
- **A blobless clone is still a network transfer.** A large repository can exceed the cache bound on its own. → The bound evicts least-recently-used entries; a single repository larger than the bound is evicted immediately after use and refetched next time, which is slow but not broken.
- **`git ls-remote` latency dominates a check.** ~1.5 s per repository means a check is not instant even in parallel. → Checks run concurrently and never block a render; the count keeps its previous value and marks itself not current only on failure.
- **Automatic build approval executes third-party code.** That is inherent to trusting a repository. → Trust is per repository, requires first-use confirmation, is revocable, writes only the exact key, and every automatic approval is disclosed in the row detail.
- **Version-at-HEAD requires a raw file fetch.** The version comes from `package.json` at HEAD, one request per git candidate when the commit moved. → Fetched only when the commit differs, so an up-to-date candidate costs one `ls-remote` and nothing more.
- **A failed check is not an update.** Mixing it into the count could overstate installable work. → It counts (something needs attention) but is visually distinct on the row and in the entry.
- **`private: true` prevents publication.** If the name ever becomes available, publishing needs a deliberate manifest change. → Intentional: the name currently belongs to an unrelated project and accidental publication is worse.

## Migration Plan

This is a new package with no prior version and no stored state, so no data migration is required.

Installation: add `github:filipeesch/dsh-plugin-updater` to the profile and select the bundle. Because the package has no build script, no build approval is needed for its own installation.

Rollback: remove the bundle. Nothing else is touched — detection state is in memory, and the only profile write it ever performs is adding an exact `allowBuilds` key for a repository the user trusted, which is inert once the plugin is gone.

First run: the plugin proposes the repositories of currently installed git plugins for confirmation, and trusts nothing until the user confirms.

## Open Questions

- The exact icon artwork is undecided; three candidates will be drawn at the intended sizes and chosen by the user. This does not affect behavior, layout, or task order.
- Whether the periodic interval should become configurable after real use. Deferred by decision; adding a field later is additive.
