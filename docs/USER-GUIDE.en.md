# User guide

[English](USER-GUIDE.en.md) · [简体中文](USER-GUIDE.md)

For plugin **0.1.4** and **Super Productivity 19.1.0+ on Windows desktop**. Install in Super Productivity; Obsidian does not need an additional plugin.

## Installation and first sync

1. Download `sp-obsidian-sync.zip` from the [0.1.4 install folder](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/tree/main/releases/v0.1.4).
2. Upload it in **Settings → Plugins**, enable **Obsidian Vault Sync**, and allow Node file access when asked.
3. Open **Obsidian Sync / Obsidian 同步**. Choose **English** in **Language / 语言**. The panel changes immediately; click **Save settings** to persist it.
4. Choose your vault root, such as `D:\Notes\MyVault`. Do not choose its generated `Super Productivity/` subfolder. Browse drives/folders or enter a path; wait for folder reading to finish before confirming.
5. Tick the projects, including **Inbox** if needed. Multiple projects can sync together.
6. Check the IANA time zone, such as `America/Los_Angeles` or `Asia/Shanghai`. Leave project-note and archive exports off initially.
7. Click **Save settings**, **Resume sync** if paused, then **Sync now**. Check **Issues to resolve**.
8. Open `Super Productivity/index.md` in Obsidian for project, tag, calendar and AI-guide links.

The ZIP is the full plugin; opening `index.html` in a browser cannot sync. To upgrade, upload the new ZIP and reopen the panel. Old settings default to Chinese. Both languages accept `|笔记`, `|notes` and legacy `sp-notes`. Successful sync uses the saved language for managed labels/AI guide while keeping IDs, paths, YAML, body text and user titles/tags. Existing headings outside generated blocks are preserved.

## Task editing

Add rows in the `tasks.md` of a selected project:

```markdown
- [ ] Write requirements #work ⏳ 2026-10-03 📅 2026-10-05 estimate [60min](<sp-estimate-minutes:: 60>)
- [ ] Prepare demo
  - [ ] Collect material estimate [30min](<sp-estimate-minutes:: 30>)
```

Sync fills in hidden IDs, block IDs and `[[full/path|notes]]`. Preserve them on existing tasks. Same-title tasks remain separate. Check/uncheck to complete/reopen; move whole rows to reorder.

Use parents and one subtask level, with two-space indentation. New subtask tags follow app rules; existing native subtask tags are read-only in Markdown. A parent's estimate is the app's remaining-time aggregate; edit subtask estimates instead. Independent task and subtask estimates are editable.

For a project move, pause sync, cut a family's rows into another selected project's task file, preserve IDs and existing notes links, save both files, resume and sync. Notes links can retain their original location. Do not duplicate IDs. Change project names in the app/YAML rather than renaming bound folders.

## Dates and estimates

```markdown
- [ ] Independent task ⏳ 2026-10-03 📅 2026-10-05 [sp-planned-time:: 14:00] [sp-deadline-time:: 18:00] estimate [90min](<sp-estimate-minutes:: 90>) [sp-expected-finish:: 2026-10-03T16:00:00-07:00]
```

| Field | Meaning |
| --- | --- |
| `⏳ YYYY-MM-DD` | Scheduled date |
| `📅 YYYY-MM-DD` | Deadline date |
| `sp-planned-time` / `sp-deadline-time` | `HH:mm`, with its corresponding date, in the configured time zone |
| `estimate [60min](<sp-estimate-minutes:: 60>)` | Non-negative minutes; keep label and value consistent |
| `sp-expected-finish` | Explicit ISO timestamp with an offset or `Z`; never automatically calculated |
| `sp-spent-minutes` / `sp-completed-at` | Read-only tracked time/completion |

All-day dates are not converted. Daylight saving gaps are rejected; ambiguous times choose the earlier occurrence. Delete a whole field to clear it. Special tag names use reversible aliases from tag indexes; `TODAY` comes from the scheduled date.

## Notes and references

Every task, including an empty Inbox task, gets a `task-notes/*.md` file. Open it through `notes` and edit its body. YAML remains local and is excluded from app notes. Multi-paragraph text, code and ordinary checkboxes stay note content.

Reference vault Markdown outside the generated folder:

```markdown
Follow [[Material/Requirements]].
See ![[Material/Meeting]].
Read [Proposal](Material/Proposal.md).
Locate [[Material/Requirements#Acceptance]].
```

Whole bodies are embedded in marked blocks in app task notes. Edits to the source or embedded body sync both ways and propagate to shared references, preserving source YAML. Keep `sp-references` and `sp-ref` boundaries. References are not expanded recursively; headings/blocks are read-only excerpts. Removing a reference only unlinks it. Source note checkboxes do not create tasks; attachments are not copied.

Use full vault paths for ambiguous names. Missing sources or conflicting copies appear in the issue list; preview and choose a version. Do not edit internal sync state to bypass issues.

## Project notes, calendar and archive

**Native project notes** are project-level notes stored in Super Productivity, separate from task notes. Export is optional and off by default. Enable **Export native project notes (read-only)** to create `project-notes/`; local edits never write back. Task notes remain available independently.

Calendar files link to tasks and notes using scheduled/deadline/expected-finish dates. Edit dates in task files or the app. Write next steps outside daily `sp-generated` blocks; free text is preserved. External calendar events are not synced.

**Export archived tasks (read-only)** is off by default. It exports native history, notes and subtasks by project/completion month to `archive/YYYY-MM.md`. These files are not live task-editing entry points.

## Removal and recovery

| Action | Result |
| --- | --- |
| Remove a linked row | Keep app task/native notes, add `sync-removed`, save a snapshot and pause its association |
| Remove a parent | Keep the native family and pause associations |
| Remove only a subtask | Record removal, mark parent, keep completion state |
| Delete/archive an app task | Clean its managed note with a recovery copy; old Markdown does not recreate it |
| Remove a file/folder | Pause its binding |
| Deselect a project | Stop syncing and keep data |

Managed notes are copied in full to `.sp-sync/removed/` before cleanup. Referenced source files are always retained. **Restore association** reconnects tasks; if deleted/archived in the app, restore there first. Missing notes are recreated. Newer app notes win while the recovery copy remains.

**View backups** supports preview/restoration. Restoring pauses sync; inspect and resume. Do not edit `.sp-sync/state.json` or recovery records directly.

## Scheduling and troubleshooting

Defaults: **10-second** delay, **30-second** file check, **120-second** full recheck. File edits usually begin syncing within about 40 seconds plus execution time. Increase intervals to group more edits and reduce disk operations. **Sync now** skips waiting. Sync stops when the app closes or the plugin is paused/disabled.

| Issue | Action |
| --- | --- |
| Disabled controls | Wait for background connection; save settings, resume and select projects |
| No background response | Check installation/enablement and Node permissions; Reconnect or reopen |
| Folder confirmation disabled | Wait for folder reading, or cancel/retry |
| Readback verification failure | Check task/fields; affected projects pause independently. 0.1.3+ fixes native subtask-tag and parent-estimate false positives |
| Missing Inbox note | Select Inbox, save and sync; resolve its issues |
| Syntax, duplicate ID or nesting error | Fix the affected task file and retry |
| Missing file | Restore it or its association; use the task-file rebuild when offered |
| Same field edited on both sides | App wins with file backup; different fields merge |
| Reference ambiguity/conflict | Use a full path, restore source, or select a version |

Use one device to write a vault. Web/mobile, repeat-rule editing, project-note writeback, attachment copying and external calendar events are outside this version. See the [validation record](VALIDATION.md) for test scope.

Before AI edits, provide the vault README or [AI editing guide](AI-GUIDE.en.md). Additional [format examples](FORMAT-EXAMPLES.md) use the same field names and IDs in both languages.
