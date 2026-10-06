# Project architecture rules

- Preserve existing routes, API contracts, hooks, and TV/D-pad attributes during visual work because the deployed interaction layer is already mature.
- Build visual changes through semantic CSS tokens and existing presentation components so the theme remains consistent without duplicating behavior.
- Derive detail-page atmosphere client-side from the existing poster artwork and preserve a dark fallback, so visual theming needs no backend or API changes.
- Use one shared artwork-atmosphere hook and shell layers for content and active collection backgrounds so tint sampling, texture, bottom fades, and cleanup stay consistent without changing navigation.