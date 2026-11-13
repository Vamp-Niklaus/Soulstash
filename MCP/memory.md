# Soulstash MCP Memory

Use this file to store durable project context for external AI tools.

## Notes
- Add architecture notes, conventions, TODOs, known bugs, and decisions here.
## Project decisions (Nov 2026)
- Live backend is `backend-go` (Go, chi, TMDB via `internal/platform/tmdb`); `old-backend-no-longer-used` is the retired Node backend. Routes for content feeds are in `backend-go/internal/handler/content_handler.go` (`/api/upcoming` added: TMDB discover, release date asc).
- Several files use CRLF line endings (NavIcons.jsx, content_handler.go): multi-line `edit_file` matches fail there; use `insert_lines`/`delete_lines` or single-line edits.
- Player: `VideoPlayerModal.jsx` Back logic is split by `[data-direct-player]` (internal kartoon player) vs iframe. iframe keeps the original zone-only rule. Do not add generic Back rules for all streams.
- Navbar items (desktop and mobile) are built in `Navbar.jsx` `navItems`: Lists -> /posted-collections, Upcoming -> /upcoming, Collection.
- Android: manifest `screenOrientation="unspecified"`; no ScreenOrientation locks in JS; `utils/externalLinkBlocker.js` blocks external links/popups in native shells.
## Workflow + Nov 12 2026 changes
- Workflow: use soulstash MCP to read/edit code, keep this memory.md updated, check history.json for past changes, use graphify MCP (query_graph/get_node) to find files cheaply instead of broad reads.
- Rule: Watched/Watchlist behavior stays on the details page; do NOT change DetailPage.
- Search "Collections" tab: `useSearchAutocomplete.js` merges `/api/collections/published?q=` (publisher = username) with new `/api/search/collections?q=` (TMDB franchises, publisher label "TMDB", no profile/avatar). Backend: `backend-go/internal/handler/search_collections_handler.go` + route in content_handler.go. `NavbarSearchOverlay.jsx` shows "Collection | <publisher>"; TMDB items open the first film (/movie/:id) of the franchise.
- Navbar Collection button when logged out: shows toast 'Please login first' (top-right) instead of redirecting to /login.
- Navbar keyboard/TV nav: profile/settings button has `data-tv-ignore`, so spatial nav skips it and focus got stuck there. Fixed: ArrowLeft in `handleProfileTriggerKeyDown` focuses the Search button (applyFocus from utils/spatialCore.js), letting nav reach Collection/Upcoming/Lists.
- Lists page (`PostedCollectionsPage.jsx`): browse mode shows PAGE_SIZE=10 cards + "View more" (like genre shelves); when searching, all matches shown as before.

