# Soulstash Architecture Documentation

## Overview
Soulstash has been completely overhauled from a monolithic Express.js backend into a **TypeScript Microservices Architecture**. This transition ensures enterprise-level scalability, strict type safety, and robust separation of concerns.

## Microservices Topology

1. **API Gateway (`services/api-gateway/`)**
   - The single entry point for all frontend traffic.
   - Handles rate limiting, authentication, and reverse proxy routing to the internal microservices.

2. **User Service (`services/user-service/`)**
   - Manages user registration, JWT issuance, password hashing, and roles.
   - Emits events when users register for analytics and email follow-ups.

3. **Content Service (`services/content-service/`)**
   - Manages media metadata from TMDB and OMDB.
   - Heavily caches responses to minimize external API costs.

4. **Scraper Service (`services/scraper-service/`)**
   - **Heavyweight Service:** Isolates headless browser (Playwright) instances from the rest of the application.
   - Resolves streaming URLs dynamically based on the requested source.

5. **Collection Service (`services/collection-service/`)**
   - Manages user playlists, watchlists, and media relationships.

6. **Shared Library (`services/shared/`)**
   - Contains strict Domain Entities (`User`, `Media`, `Collection`).
   - Contains internal Interfaces (`IMetadataProvider`, `IVideoScraper`).
   - Contains Singleton utilities (`Logger`, `ConfigManager`).

## Technologies
- **Language:** TypeScript (ES2020)
- **Runtime:** Node.js v20+
- **Architecture:** Microservices, Clean Architecture, Ports and Adapters
- **Communication:** REST / HTTP Proxies (Event Bus planned)
