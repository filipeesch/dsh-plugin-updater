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

**Expect, expanded sidebar:** an entry reading **Plugin Updater**, directly above **Settings**, with an upward-arrow icon, the label on the left, and on the right the count and a refresh button. A failed check is a small amber dot beside the count, not a sentence.

**Expect, collapsed rail (56px):** the upward-arrow icon with a small count badge in its bottom-right corner; the amber dot when a check failed; a progress ring while work runs.

**Expect, panel list:** `Plugin Updater` does **not** appear among Plugins and Tasks, and it is **not** in the overflow menu. This is intentional: it lives in the footer.

## 3. First check

Wait a few seconds after start, or click the refresh button.

**Expect:** the count settles on the number of plugins needing attention. The refresh icon spins while the check runs and the previous count stays visible.

If the count is 0 and nothing is pending, that is a valid result — the profile may have been updated since.

## 4. Open the panel

Click the icon or the label.

**Expect:** a panel opens in the main column, centered, with the title **Plugin Updater**, a one-line summary of pending work, the last check, and two equal-width tabs: **Updates** and **Settings**. The Updates tab is selected and is operable with the arrow keys.

**Expect a toolbar above the list** with **Check now** and **Update all**. The toolbar stays visible while the list scrolls.

**Expect one flat row per pending plugin**, separated by hairlines, showing the name, a source chip (`GitHub` / `npm` / `Local`), the version change (`0.34.0 → 0.35.0`) or a commit count when the version did not move, a status badge and the row action.

**Expect a "Show changes" link** on a git row. Open it: the commit messages appear and scroll inside the row when long.

## 5. Trust a repository from its row

On a git row, look for **Trust this repository**.

**Expect:** the action appears only for a git candidate whose repository is not trusted. Activate it and confirm the repository appears under **Settings → Trusted repositories**.

**Expect:** no first-use confirmation dialog appears. Trust is offered per row now, and nothing is trusted until you use that action or choose **Always allow** on an approval request.

## 6. Update one plugin

Back on **Updates**, click **Update** on a row and watch closely.

**Expect the row to show the current step**: Checking, Removing, Installing or Restoring. **Show output** reveals the package manager lines and keeps appending while the step runs.

**Expect a completion notice** at the top of the window even if you close the panel, and a **View details** action that opens the panel.

**Expect the finished row to stay** with an **Updated** (or **Failed**) badge and a dismiss control. The next manual check clears it; an automatic check does not.

**Critical check — run this after the update:**

```
grep dsh-kanban ~/.dsh/profiles/web/package.json
```

**Expect** exactly `"dsh-kanban": "github:filipeesch/deepseek-harness-kanban"` — **with no `#<sha>` at the end**. A pinned commit here is a serious defect: it would silently stop this plugin from ever detecting a future update.

Then let a check run again and confirm the row does **not** come back as pending for the same commit.

## 7. Build approval path

Optional but valuable. Use a git plugin whose installation needs a build script, from a repository that is not trusted.

**Expect:** the candidate is restored, its row shows **Needs approval** with a card naming the exact entries, and the card offers **Allow and install**, **Always allow <repository>** and **Not now**. The other candidates in a batch continue.

**Expect:** **Allow and install** completes the update with exactly those entries; **Always allow** also adds the repository under Settings; **Not now** leaves the previous version installed.

## 8. Restart behaviour

If the panel showed a restart notice after an update, restart DSH and confirm the notice is gone.

If no notice appeared, that is also correct: it is shown only when the host actually reports that a restart is required.

## 9. Failure path

Optional but valuable. Pick a git plugin and temporarily point it at a commit that cannot install, or disconnect the network mid-update.

**Expect:** the previous commit is reinstalled, the row reports **Failed** or **Restored** with the reason, the output opens by itself, and the plugin still works afterwards. The `package.json` value must again end with no pinned commit.

## What I could not verify

The component tests cover the panel's model, store, and host contract, but these need the running interface:

- the live step and streamed output against a real package manager run
- the completion notice while the panel is closed
- the approval card against a genuinely blocked build script
- both themes at the real window width

Steps 2 through 9 above cover them. If any fails, report the step and what you saw.
