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
## Session notes (Nov 21, 2026)
- Search overlay (`NavbarSearchOverlay.jsx`, `useSearchAutocomplete.js`): Collections tab merges published user collections (publisher = username) with TMDB franchises from new `GET /api/search/collections` (`backend-go/internal/handler/search_collections_handler.go`, publisher label "TMDB", no profile). Result meta reads `Collection | <publisher>`. TMDB item click opens the franchise's first film (detail page already shows the collection section; detail page untouched).
- Keyboard nav (`useOverlaySearchKeyboardNav.js`): TAB_VALUES now has 4 tabs; clear button focus index moved from -5 to -7 because -5 is the Collections tab (this was why Right got stuck after Users).
- Navbar "Collection" click while logged out: shows toast 'Please login first' (top right) instead of navigating to /login.
- `PostedCollectionsPage.jsx`: browse mode shows 10 cards + "View more" (+10 per click); search mode shows all matches as before.
- Android `MainActivity.java`: nothing opens outside the app. Main-frame navigation limited to app URLs; iframe navigation stays in-frame (http/https only); popups blocked (onCreateWindow false, supportMultipleWindows true, JS auto-open off); downloads only from trusted hosts. Player: "Open Provider" icon hidden and "Open in App" YouTube button removed on native; non-embeddable sources show "cannot play inside the app" message. Needs APK rebuild to take effect.
- `MCP/server.js` (restart the MCP server to apply): search capped at 40 files / 8 matches per file, lines clipped to 300 chars, skips android assets/build, graphify-out and old-backend; read_file defaults to 400 lines with a "more lines remain" hint; edit_file now matches multi-line old_text in CRLF files.
## Trailers (Nov 21, 2026)
- Trailers: new backend routes `/api/movie|movies/:id/videos`, `/api/series|tv/:id/videos`, `/api/series/:id/season/:n/videos`, `/api/series/:id/season/:n/episode/:e/videos` (`backend-go/internal/handler/videos_handler.go`, TMDB proxy, includes language-less videos). SPA: `spa/src/api/trailers.js` `fetchTrailer` (episode -> season -> series fallback); `pickBestTrailer` in `utils/formatters.js` ranks Trailer > Teaser/Clip > other, then higher `size` (quality), then official, then newest. Used in DetailPage for unreleased titles and unaired episodes (falls back to `content.videos`).

