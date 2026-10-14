# Actionable Table Interaction

Topic: `table-interaction`

Status: Current-within-selection direction accepted and implemented for product
trial on 2026-08-03 through
[`069`](../tactical/069-current-within-table-selection.md). This replaces the
independent active-versus-batch command model implemented by
[`068`](../tactical/068-active-and-batch-table-interaction.md) after trial use
showed that one action bar could not safely infer which independent set to
target. Tactical [`085`](../tactical/085-unified-contextual-selection-actions.md)
adds the accepted desktop context-invocation contract without changing that
selection model or the touch/pen long-press gesture.

## Purpose And Scope

This topic owns row selection, current-row detail, keyboard focus, range
behavior, and action scope for actionable tables in the shared browser and
Tauri presentation.

The contract applies to Transfers torrents, Workbench torrents, and Workbench
Files. It also applies when a future table gains row actions or a current-row
detail, preview, or inspector. Files follows it before a file preview exists so
that adding one does not require a different selection model.

Read-only tables such as Peers, Swarm, Trackers, Disk, and Logs do not gain
checkboxes or multi-selection merely for consistency. They may use the
singular current-row portion when they have a genuine row detail.

This topic does not decide which commands exist, whether a destructive command
permits multiple targets, what a future file preview contains, or whether an
Android presentation uses the same mechanics.

## Vocabulary

### Selection

The **selection** is the complete set of checked rows. It contains zero, one,
or many rows and is always the target of table actions. Checkbox state and
`aria-selected` represent it exactly; there is no separate batch mode or
implicit action scope.

### Current row

The **current row** is singular and is always a member of the selection. It is
the row being navigated, receives the strongest row treatment, owns row-level
keyboard focus, and supplies detail or preview. Multi-selection never causes
details to be unioned or intersected: detail always shows the current row.

The current row is a constrained lead within selection, not another
independent selection. Ordinary row activation and bare navigation replace
selection with the one current row. Modifier, checkbox, range, and select-all
gestures build a larger selection.

### Keyboard focus and range anchor

Row-level keyboard focus follows current and is not a third visible row state.
Focus may temporarily move to a checkbox, header control, resize separator,
menu, or dialog without changing current. Returning to row navigation restores
current as the roving focus target.

The range anchor is transient table mechanics. It identifies the fixed end of
Shift ranges but receives no persistent product meaning or visual state.

## Core Invariants

- Selection contains exactly the rows represented by checked controls and
  `aria-selected=true`.
- Current is null when selection is empty; otherwise current names one selected
  row.
- Keyboard row focus and current do not drift independently.
- Detail represents current only, never aggregate data synthesized from the
  selection.
- Actions target the complete selection without a mode, recency heuristic, or
  toolbar action-scope switch.
- Row-body activation and bare row navigation replace selection with one row.
- Checkbox, modifier, Space, Shift range, select-all, and bounded touch/pen long
  press interactions may build or reduce a multi-selection.
- Sorting, filtering, and virtualization never limit range or select-all to
  rows mounted in the DOM.
- Read-only tables do not acquire multi-selection without row actions.

## Interaction Contract

### Pointer and touch

| Interaction | Result |
| --- | --- |
| Click or tap a row body | Replace selection with that row, make it current, move row focus to it, and update detail. |
| Click a row checkbox | Toggle that row without clearing other selected rows. Preserve current unless it was removed or selection was previously empty. |
| Command/Control-click a row | Apply the same additive toggle as its checkbox. |
| Shift-click a row or checkbox | Replace selection with the inclusive anchor-to-clicked range in current sorted/filtered order; make the endpoint current. |
| Click the header checkbox | Select or clear every logical row in the current filtered table while preserving selected rows outside that table until an exact replacement gesture. |
| Right-click a selected actionable row | Preserve current and the complete selected set, including hidden targets, and open actions for that exact ordered snapshot. |
| Right-click an unselected actionable row | Replace selection/current with that singleton before opening its actions. |
| Long-press with touch or pen | Toggle the held row through the additive selection path, subject to movement, scrolling, cancellation, and synthetic-click guards. |
| Activate empty table space | Clear selection, current, and its detail when the table permits an empty selection. |

Checkbox and modifier interactions do not bubble into singleton row-body
activation. A row-body tap has the same singleton meaning whether selection
currently contains one row or many.

### Keyboard

| Key | Result while row navigation owns focus |
| --- | --- |
| Arrow Up / Arrow Down | Move current and focus by one logical row, replace selection with that row, scroll it into view, and update detail. |
| Home / End | Move current and focus to the first or last logical row and replace selection with it. |
| Shift+Arrow | Grow or shrink an inclusive contiguous selection from its anchor; make the moving endpoint current. |
| Shift+Home / Shift+End | Replace selection with the anchor-to-edge range; make the endpoint current. |
| Command+A / Control+A | Select all logical rows in the current filtered table while retaining current if it is included. |
| Space | Toggle the current row through the additive selection path. |
| Shift+Space | Replace selection with the inclusive anchor-to-current range. |
| Enter | Reveal or activate current detail behavior without changing selection. |
| Context Menu key or Shift+F10 | Open the actionable row menu for the complete selection; first establish the focused row as the singleton when it is not selected. |
| Escape or Done | Collapse a multi-selection to current. |

Both Meta+A and Control+A may be recognized at the web event boundary without
user-agent inference. Select-all must not override native text selection in an
input, textarea, editable surface, dialog, menu, resize control, or other
nested control.

Activating empty table space moves focus to the grid as it clears selection.
The focused grid handles Command/Control+A even when no row is currently
selected. An actionable grid with no rows consumes that shortcut without
selecting page text.

If a table has rows but no current row when row navigation receives focus, the
focused row becomes the singleton selection. Empty tables ignore selection
shortcuts.

Tactical
[`100`](../tactical/100-bep53-select-only-and-duplicate-add-feedback.md) adds
one programmatic singleton transition: a successful new or duplicate add makes
the typed result torrent current and selected, chooses a category that can
show it when necessary, and asks the virtual table to reveal it. This does not
move DOM focus into row navigation, open detail, or create an independent
highlight state; the Add control retains focus for repeated intake.

## Sorting, Filtering, And Virtualization

Range and select-all resolve against the complete logical row model after the
current filter and sort, not source insertion order or the virtual DOM window.

Configured-visible columns likewise remain rendered independently of the
virtual row window. Above the narrow breakpoint (760 px) a viewport that is
too narrow scrolls horizontally through the complete configured set.

At and below that breakpoint, Tactical
[`351`](../tactical/351-narrow-web-lists-and-flat-chrome.md) renders the same
grid as stacked list items built from each table's declared list roles, with
a Sort field in place of column headers. Responsive layout still does not
change row selection, focus, or action scope. A list shows checkboxes only
while several rows are selected; long press starts that, and a tap then
toggles a row instead of making it the singleton current row. With one row
selected, a tap opens it as before.

Stable identity preserves selected and current rows through sorting and live
updates. Disappearing selected rows are pruned. If current disappears while
other selected rows remain, one of those rows becomes current; if none remain,
current and detail clear. An explicitly empty selection does not invent a
fallback on later updates.

Transfers and Workbench share torrent selection across destinations. Choosing
a torrent category drops selected targets the category hides, matching Android
tab changes, so bulk actions never reach rows the user just filtered away; if
current is dropped, the first remaining target becomes current, otherwise
current and detail clear. Targets can still be outside the current view after
switching destination, and status then explicitly reports how many. Individual
checkbox and modifier toggles, and the header checkbox, preserve hidden
selection. Singleton row activation, Shift ranges, and Command/Control+A are
exact replacement gestures and discard targets outside their new logical
selection.

When a category hides every torrent, the empty table names that category and
offers Show all torrents; an empty session keeps its first-run guidance.

Changing sort or filter invalidates a range anchor only when its row is no
longer in the logical table. The next Shift gesture falls back to current and
then its own endpoint rather than using a stale index.

A context menu retains one exact target snapshot rather than following later
checkbox history. Changing the target set, filtering the origin away, or
virtualizing the origin out of the rendered window closes the menu. Torrent
target order follows the complete materialized application order; file target
order follows metainfo index.

## Visual And Accessibility Contract

- Every selected row has a checked checkbox and lighter selection treatment.
- Current uses the strongest current-row treatment and, because it belongs to
  selection, also remains checked.
- A keyboard focus ring appears on current during row navigation and cannot
  identify a different row.
- Color is not the only distinction: checkbox state, `aria-selected`,
  `aria-current`, and focus remain perceivable in every theme.
- Multi-selection status uses explicit action language such as “3 selected for
  actions”; hidden selected targets disclose their outside-view count.
- Focus remains roving and virtualized while offscreen logical selection does
  not expand the DOM.
- A genuine nested row control may preserve its own keyboard focus and suppress
  row-body gestures. Tactical `070` uses this exception for an error-bearing
  torrent status: it first establishes that torrent as the singleton current
  selection, then opens the focused General error detail. A status without an
  attached error remains plain text.

Done may remain visible while multiple or hidden rows are selected for touch
discoverability. It collapses to current rather than ending a mode.

## State Ownership And Naming

Current and selection are ephemeral presentation concerns. They are not
persisted as engine or application truth and do not cross the Rust application
boundary.

- Singular lead values use a `current...Id` concept.
- Checked command targets use `selected...Ids`.
- No selection-mode boolean or independent batch-selected set is retained.
- `VirtualTable` owns focus, scrolling, range-anchor mechanics, and logical
  toggle fallback.
- Torrent presentation owns the current torrent and selected torrent set.
- Mounted Files owns current file and selected file IDs until a broader file
  detail owner provides evidence for lifting them.

## Evidence And Direction History

Tacticals [`058`](../tactical/058-contextual-table-selection.md) and
[`059`](../tactical/059-actionable-table-range-selection.md) established
actionable checkbox geometry, sorted Shift ranges, touch long press, Space,
Escape, and virtualization bounds.

Tactical [`068`](../tactical/068-active-and-batch-table-interaction.md)
synchronized focus with a singular active row and added keyboard ranges and
select-all, but deliberately allowed active to remain outside checked batch
targets. Trial use showed the resulting action ambiguity: tapping a row made
its detail current while the action bar still targeted an older batch.

Tactical [`069`](../tactical/069-current-within-table-selection.md) supersedes
that independence while retaining the useful keyboard, accessibility, hidden
target disclosure, and scale work. The accepted simplification is that a user
cannot browse an unrelated row while preserving a multi-selection: ordinary
navigation intentionally collapses to that one row.

Tactical [`070`](../tactical/070-actionable-torrent-error-status.md) applies
the nested-control rule to the concrete support failure that motivated it.
Pointer and keyboard activation cannot bubble into range or row selection, and
the destination, singleton selection, General tab, open detail, and one-shot
focus target change atomically.

Tactical [`071`](../tactical/071-copy-magnet-link.md) applies the same explicit
action-scope rule to canonical magnet copy. Tactical
[`085`](../tactical/085-unified-contextual-selection-actions.md) supersedes its
singleton presentation limit: one or many selected torrents now produce one
newline-delimited clipboard write in stable full-selection order. It still
never chooses a current or visible subset implicitly. Tactical
[`107`](../tactical/107-source-aware-magnet-export.md) changes only how each
target's value is obtained: all explicit targets must export successfully
before the single clipboard write, so failure cannot create a partial copy.

Tactical `085` also proves selected/unselected pointer targeting, Shift+F10,
hidden-selection preservation, stale context closure, focus return, grouped
toolbar/context action parity, and the 4,096-file virtualization bound. Its
complete deterministic browser gate passed 29 cases with seven live opt-in
cases skipped and no serious or critical Axe findings.
Tactical [`221`](../tactical/221-context-menu-dividers.md) keeps that action
order and parity while displaying only dividers between nonempty groups; row
context and More menus no longer show category headings.

Tactical [`222`](../tactical/222-torrent-settings-dialog.md) adds Torrent
settings to the shared torrent action set. It opens a dialog for exactly one
target; a multi-selection retains its scope and disables the setting action.
Dismissal returns focus to the invoking row or More control.

The Peers table uses only the singular current-row portion of this model,
keyed by the active connection generation. It has no checkbox column or
multi-selection. A live-adapter regression that cleared the current peer on
every refreshed snapshot is corrected by retaining it while the same
`torrent_id` and `connection_id` row remains, and clearing it on keyed removal
or replacement. Reducer tests cover both snapshot retention and removal.
