# Install checklist

Run these steps in order. Report what you see; anything that differs from the expected result is a defect worth fixing before this plugin is trusted with updates.

## 1. Install

```
dsh plugin --profile web add github:filipeesch/dsh-plugin-updater
```

**Expect:** the command succeeds and prints no build-script approval request. This package has no build script, so its own installation must never need one. If it asks, stop and report it — that is the circularity this design avoids.

**Verify the dependency** in `~/.dsh/profiles/web/package.json`:

```json
"dsh-plugin-updater": "github:filipeesch/dsh-plugin-updater"
```

## 2. Restart and check the entry

Restart DeepSeek Harness fully, then look at the sidebar.

**Expect, expanded sidebar:** an entry reading **Plugin Updater**, directly above **Settings**, showing an icon, the label on the left, and on the right a count and a refresh button.

**Expect, collapsed rail (56px):** just the icon, with a small count badge in its bottom-right corner.

**Expect, panel list:** `Plugin Updater` does **not** appear among Plugins and Tasks, and it is **not** in the overflow menu. This is intentional: it lives in the footer.

## 3. First check

Wait a few seconds after start, or click the refresh button.

**Expect:** the count settles on the number of plugins needing attention. On this profile that was **1** at the time of writing (`dsh-kanban`, installed at `0.34.0` with HEAD at `0.35.0`).

**Expect the refresh icon to spin** while the check runs, with the previous count still visible.

If the count is 0 and nothing is pending, that is a valid result — the profile may have been updated since.

## 4. Open the panel

Click the icon or the label.

**Expect:** a panel opens in the main column, titled **Plugin Updater**, with two tabs: **Updates** and **Settings**. The Updates tab is selected.

**Expect one row per pending plugin**, showing the name, the source (`GitHub` / `npm` / `Local`), the version change (`0.34.0 → 0.35.0`) or a commit count when the version did not move, and an **Update** button.

**Expect a "Show changes" link** on a git row. Open it: the commit messages should appear and the list should scroll inside the row if it is long.

## 5. First-use trust proposal

Open **Settings**.

**Expect:** the trusted repository list is either empty or contains only repositories you confirmed. Nothing is trusted silently.

**Try adding a wildcard** like `filipeesch/*` and confirm it is refused with an explanation that trust is per repository.

**Try adding** `github.com/filipeesch/deepseek-harness-kanban` and confirm it appears in the list.

Report whether a first-use confirmation dialog appeared. If none appeared and the list was already populated, that is a defect: trust must not be granted without confirmation.

## 6. Update one plugin

Back on **Updates**, click **Update** on the kanban row, and watch closely.

**Expect the row to pass through** these states: working, then updated — or, if the build script is blocked, restored plus an approval request.

**Expect the count to drop** by one after the panel reloads.

**Critical check — run this after the update:**

```
grep dsh-kanban ~/.dsh/profiles/web/package.json
```

**Expect** exactly `"dsh-kanban": "github:filipeesch/deepseek-harness-kanban"` — **with no `#<sha>` at the end**. A pinned commit here is a serious defect: it would silently stop this plugin from ever detecting a future update.

Then let a check run again and confirm the row does **not** come back as pending for the same commit.

## 7. Restart behaviour

If the panel showed a restart notice after step 6, restart DSH and confirm the notice is gone.

If no notice appeared, that is also correct: it is shown only when the host actually reports that a restart is required.

## 8. Failure path

Optional but valuable. Pick a git plugin and temporarily point it at a commit that cannot install, or disconnect the network mid-update.

**Expect:** the previous commit is reinstalled, the row reports **Restored** with the reason, and the plugin still works afterwards. The `package.json` value must again end with no pinned commit.

## What I could not verify

These four were left unchecked in `tasks.md` because they need the running interface:

- 6.1 first-use trust proposal actually refusing to trust before confirmation
- 6.2 a real end-to-end git update
- 6.3 a forced failure restoring the previous commit
- 6.4 the restart notice appearing only when the host reports it

Steps 2 through 8 above cover them. If any fails, tell me which step and what you saw, and I will fix it.
