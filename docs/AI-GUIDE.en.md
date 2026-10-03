# AI editing guide · Format version 1

This folder synchronizes Obsidian Markdown with Super Productivity. Read this guide before editing. The application must be running, the plugin enabled, and sync resumed. By default, app changes wait 10 seconds and files are checked every 30 seconds; file edits usually begin syncing within about 40 seconds. Both intervals are configurable. **Sync now** skips the wait.

## Editing locations

| Content | Edit here |
| --- | --- |
| Title, completion, tags, estimate, dates, order, subtasks | The selected project's `tasks.md` |
| A task's own notes | The `task-notes/*.md` file linked from its task row |
| Referenced note body | The original Obsidian note, or its `sp-ref` block inside the app task notes |
| Expected finish | `sp-expected-finish`, or the plugin panel |
| Next steps and personal notes | Outside generated blocks in daily notes |
| Project name | `sp-project-title` in the project task file YAML, or the app |
| Tag name and color | `sp-tag-title` and `sp-tag-color` in tag index YAML, or the app |

The `sp-generated` blocks in root, project, tag and calendar indexes are generated views. Archives and optional `project-notes/` files are read-only exports. `.sp-sync/` holds internal state, recovery records and backups: do not edit it. Free text outside generated blocks is preserved.

## Creating tasks and subtasks

Create tasks only in a selected project's `tasks.md`. Checkboxes in referenced note bodies do not create tasks.

```markdown
- [ ] Write requirements #work ⏳ 2026-10-03 📅 2026-10-05
  - [ ] Collect existing material estimate [30min](<sp-estimate-minutes:: 30>)
- [ ] Independent task estimate [60min](<sp-estimate-minutes:: 60>)
```

Parent tasks have no indentation; subtasks use two spaces. Only two levels are supported. Subtasks inherit the parent's project and follow native app tag rules. Existing subtasks may retain their own tags, which are read-only in Markdown; edit them in the app. Do not assign tags to new subtasks. A third level pauses the affected file.

A parent's estimate is the app's aggregate of remaining time for unfinished subtasks. Edit the subtask estimates to change that total. Independent task and subtask estimates are editable; do not use a parent's estimate as a separate budget.

Do not invent task IDs. Sync fills in `<!-- sp:task:... -->`, `^sp-...` and the notes link. Preserve all three. Identity comes from the ID, not the title; identical titles can belong to different tasks.

## Fields and completion

Preserve identity and the notes link while changing the relevant text or field.

```markdown
- [ ] Independent task #work ⏳ 2026-10-03 📅 2026-10-05 [sp-planned-time:: 14:00] [sp-deadline-time:: 18:00] estimate [90min](<sp-estimate-minutes:: 90>) [sp-expected-finish:: 2026-10-03T16:00:00-07:00]
```

- `[ ]` is open and `[x]` is complete. Unchecking reopens the task.
- `⏳` is the scheduled date; `📅` is the deadline. Use valid `YYYY-MM-DD` dates.
- Times use `HH:mm` and require their corresponding date. They use the configured IANA time zone. Daylight saving gaps are rejected; ambiguous times choose the earlier occurrence. All-day dates are not converted.
- Estimates are non-negative minutes. Change the link value and its visible minutes together. `[sp-estimate-minutes:: 90]` and `estimate [90min](sp-estimate-minutes:: 90)` remain compatible; export uses angle brackets for reading mode.
- Expected finish requires `Z` or a time zone offset. It is saved separately and is never calculated from the estimate.
- Remove an entire field or date marker to clear it. Do not replace it with words such as "tomorrow".
- `sp-spent-minutes` and `sp-completed-at` are read-only; they do not edit tracked history.
- Tags use `#tag`. Special names use reversible aliases shown in tag indexes. `TODAY` is managed by the scheduled date, not created as an ordinary tag.

## Order, relationships and project moves

Move whole task rows within `tasks.md` to reorder them. Change indentation to change relationships, keeping parents and their subtasks together and using at most two levels.

To move a family across projects, cut its rows into another selected project's `tasks.md`. Preserve IDs, block IDs and the existing notes links; save both files before syncing. You can pause sync during the move. Do not copy the same ID into two files. Promote a subtask to a root task before moving it on its own; promotion retains its own tags, or inherits parent tags if it has none, following native rules.

## Task notes and referenced notes

Every task gets its own notes file, including new Inbox tasks with empty notes. Empty files have task/project identity YAML; adding body text writes it back to the app. Multi-paragraph Markdown, code blocks and ordinary checkboxes are supported. YAML stays in the file and is not copied into app notes.

English mode uses `[[Super Productivity/projects/Project--ID/task-notes/TaskID|notes]]`. Reading mode shows only `notes`, which opens the original file. Chinese mode uses the alias `笔记`. The parser accepts both aliases and legacy `[sp-notes:: [[path]]]` or plain-path fields regardless of the selected language. Preserve the alias and path. Language changes update managed display labels while keeping task IDs, note paths, YAML and body text.

```markdown
Follow [[Material/Requirements]].
See ![[Material/Meeting]].
Read [Full proposal](Material/Proposal.md).
Heading reference: [[Material/Requirements#Acceptance]].
```

Whole-note bodies are embedded in app task notes and can be edited in either place. Heading and block references provide read-only excerpts. References are not expanded recursively; attachments are not copied.

Writable references must point to vault Markdown outside the plugin's generated folder. Edit another task's notes directly in its file. Files inside the plugin folder allow only read-only heading/block references to avoid embedding sync blocks into one another.

Keep the `sp-references` and `sp-ref` start/end markers. Edit only the body inside them. Source YAML is excluded from the embedded body and is preserved on writeback. Removing a link or reference block only unlinks it; it does not delete the source file.

For ambiguous names, use the full vault path. Missing files, damaged boundaries and conflicting copies require resolution in the plugin issue list. Do not guess a target or overwrite a version.

## Deletion, conflicts and recovery

Removing a linked task row saves a snapshot, retains the app task and its native notes, adds `sync-removed`, and pauses that association. Removing a parent retains its family; removing only a subtask records its removal and marks the parent. Use **Restore association** to reconnect it instead of creating a same-title replacement.

The managed `task-notes/*.md` file is copied in full to `.sp-sync/removed/` before cleanup, including YAML and unsynced text. The recovery path is persisted before deleting the managed copy. If it changes during cleanup, the original is kept and an issue is reported for retry. Restoring the association recreates a missing note. If app notes changed after removal, the app body wins and the recovery copy remains.

Deleting or archiving a task in the app also cleans its managed notes and keeps a recovery copy. Old Markdown does not recreate it automatically. Restore the app task before restoring its association. Referenced source notes are always kept.

A missing file, directory or app project pauses its binding. Deselecting a project only stops sync and keeps its data.

When both sides change the same field, the app wins and the old file is backed up. Changes to different fields merge. Initial binding merges content without title matching or interpreting an absent row as deletion. **View backups** supports preview and restoration; restoring a backup pauses sync until you inspect it and resume.

Malformed task syntax, duplicate IDs and unsupported nesting pause the affected file and preserve the original. Follow the issue list; do not edit internal state to suppress errors.

## Language and optional exports

Choose **English** in **Language / 语言**, then **Save settings**. The UI changes immediately; generated labels and this guide change on the next successful sync. Old settings default to Chinese. Existing headings and personal text outside generated blocks are preserved, so old documents may retain Chinese headings.

Native project notes are project-level notes stored in Super Productivity, separate from task notes. `project-notes/` export is optional, off by default, and read-only; enable it only if you want these project-level notes in the vault. It never writes local edits back. Archived tasks are also an optional read-only export, grouped by project and completion month.

Calendar indexes link to tasks and notes. Edit dates in the app or `tasks.md`; write next steps outside generated blocks. External calendar events, attachment copying, repeat rule editing, native project-note writeback and multiple simultaneous writers are outside this version. Sync runs only while the desktop app is running. Use one device to write a vault.
