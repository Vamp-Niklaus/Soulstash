# Soulstash cinematic frontend refresh

## Goal
Give Soulstash a distinctive, premium OTT identity for movies, series, and anime while preserving every existing workflow and interaction.

## What will change
- Establish a cohesive cinematic theme with near-black theater surfaces, warm marquee accents, cool screen-light accents, stronger typography, and consistent focus states.
- Refine the existing home shelves and Trending presentation without adding sections or changing the available content.
- Improve the existing poster cards and anime filter through restrained labels and accent treatments, using only data already provided by current APIs.
- Refine the top and mobile navigation, shelf headings, poster cards, loading states, empty states, and key detail-page surfaces to feel like one product.
- Preserve the compact, scannable poster layout and ensure the first viewport still reveals discoverable content.
- Keep desktop, mobile, keyboard, and TV remote interaction usable and visually clear.

## Safety boundaries
- Do not change API calls, authentication, collection behavior, playback, routes, caches, or data models.
- Preserve DOM attributes and ordering relied on by TV/D-pad navigation.
- Reuse real catalog artwork already supplied by the app; no invented titles or placeholder content.
- Keep all current pages and actions available; add no tabs, pages, sections, or components.

## Technical approach
- Add semantic design tokens in the global stylesheet, then replace scattered one-off visual colors in the touched UI.
- Restyle existing React presentation components only; do not introduce new components.
- Focus changes in the global theme, navigation, home shelves, poster cards, section headings, anime filter, and detail presentation.
- Update app metadata only if its current description does not clearly represent movies, series, and anime.
- Validate the running preview at desktop and mobile widths, including focus visibility and error-free rendering.

## Verification
- Confirm the project compiles without errors.
- Check home, content detail, search/navigation, and collection surfaces in the browser.
- Verify no visual overlap, clipped text, broken artwork, or lost keyboard/TV focus indicators.
