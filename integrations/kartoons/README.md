# Kartoons integration notes

This folder is an isolated planning area. No application routes or playback behavior are wired into Soulstash yet.

## Prototype locations

The local prototype is at `C:\Users\rakes\Documents\sim\sim`.

- `index.html` and `index_binge_backup.html` combine catalog browsing, episode selection, player UI, and provider playback in one page. The player code is coupled to a third-party stream resolver, so it is not copied here.
- `Soulstash-main/spa/src/api/kartoons.js` contains catalog/detail API calls, metadata normalization, and watch URL helpers.
- `Soulstash-main/spa/src/components/ui/Cards/KartoonCard.jsx` contains a standalone catalog card.
- `Soulstash-main/spa/src/components/player/KartoonWatchModal.jsx` embeds the provider's own player page in an iframe.
- `Soulstash-main/spa/src/pages/Binge/` and the corresponding Home, Navbar, and App files contain the browsing and route integration.
- `server.py`, `scrape.py`, and `Binge/app/src/main/java/com/binge/app/data/StreamRepository.kt` include additional provider/playback paths; they are not a clean, provider-independent player module.

## Safe integration boundary

Before connecting a catalog or player, use a documented API and playback method that Soulstash is authorized to distribute. Keep the provider-specific catalog adapter separate from the generic player:

1. The catalog adapter returns stable IDs, title, category, synopsis, year, artwork, and pagination.
2. The detail adapter returns seasons and episode metadata for those IDs.
3. A playback adapter accepts a provider ID and returns only a documented, authorized embed or stream reference.
4. The shared player handles controls and media formats; it does not discover, scrape, proxy, or extract provider streams.

The planned first feature can be a separate Anime/Cartoons browse section backed only by an authorized metadata feed. Search merging with TMDB can be designed later without changing the existing TMDB response contract.

## Current status

This is documentation only. No Kartoons API client, stream resolver, frontend route, or backend endpoint has been added to the active Soulstash app. Once an authorized catalog and playback API are available, implement the adapter here and connect it through explicit app routes.
