# Card Browser

Last modified: 13/02/2026

## Overview

Card Browser is a table view of all cards in your vault.
Use it to find, filter, edit, and manage cards in bulk.

## Main controls

- **Sort**: click a column header to sort; click again to reverse order.
- **Search**: text search across card fields.
- **Filters**:
	- Type (Basic, Cloze, MCQ, IO, Ordered)
	- Stage (New, Learning, Review, Relearning, Suspended, Buried)
	- Due status (Due, Today, Later)
- **Reset**: clears filters back to default.

## Edit and bulk actions

- Select one or more rows.
- Use actions to edit, suspend/unsuspend, or clear selection.
- Changes from edit actions appear in the table immediately.

See [[Suspending Cards]] for suspend behavior.

## Pagination and layout

- Move through pages using controls at the bottom.
- Change rows per page from the page-size selector.
- Use **Expand table / Collapse table** to switch width.

## Edge cases

- If no rows appear, check active filters and search text first.
- Some columns may be hidden if column visibility was changed.
- Bulk actions only apply to selected rows.
