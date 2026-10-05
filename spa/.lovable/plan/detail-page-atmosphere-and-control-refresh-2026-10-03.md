# Detail-page atmosphere and control refresh

## Changes
- Remove the “Browse the catalog” kicker wherever large section headings use it.
- Remove the entire home-page “Now showing” landscape slider while keeping the existing Trending grid and API data.
- Restyle “Mark as Watched” and “Add to Watchlist” so inactive and selected states are distinct, restrained, and consistent with the cinematic theme.
- Extract a safe dominant color from the current poster in the browser and use it as a subtle detail-page background wash; retain the normal dark background if extraction fails.

## Technical details
- Keep all routes, APIs, tabs, collection actions, and remote-navigation attributes unchanged.
- Color extraction will run client-side from the existing poster URL; no backend changes or extra API calls.
- Limit the generated tint’s saturation and brightness so text contrast remains readable.
- Verify the home page and movie/series detail pages at desktop and mobile widths, including selected button states and keyboard focus.
