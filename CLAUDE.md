# Soulstash Monorepo — Developer & Claude Code Guide

Welcome to **Soulstash**, a high-performance cross-platform movie & series streaming application with custom collections, TV spatial navigation, and anime integration.

This document serves as the primary context and operating manual for **Claude Code** and developers working in this repository.

---

## 1. Monorepo Architecture

The repository is structured as a unified monorepo:

```
Soulstash/
├── spa/                   # React 19 Frontend (Vite, Tailwind, React Query, Video.js)
│   ├── src/
│   │   ├── api/           # API clients (TMDB, backend, Kartoons)
│   │   ├── components/    # Reusable UI, cards, layout, modals, video player
│   │   ├── hooks/         # Spatial nav, media actions, live collections, two-row shelf limits
│   │   ├── pages/         # Explore (Home, Trending, Upcoming, Genres), Content Details, Collections
│   │   └── utils/         # Image URL helpers, formatters, watch progress, toast, TV nav
│   └── dist/              # Production web build output
│
├── backend-go/            # Go Backend API (Chi router, MongoDB, TMDB client, Kartoons solver)
│   ├── cmd/server/        # Entrypoint (main.go)
│   ├── internal/
│   │   ├── config/        # Environment and config loading
│   │   ├── domain/        # MongoDB models (Users, Collections, TrafficLogs)
│   │   ├── handler/       # HTTP Handlers (Auth, Content, Collections, Ratings, Kartoons)
│   │   ├── middleware/    # Auth JWT, rate limiters, logging
│   │   ├── platform/      # MongoDB connection and database client
│   │   └── service/       # Content scoring, adult decision engine, recommendations
│   └── render.yaml        # Render.com deployment manifest
│
├── android/               # Capacitor Android TV & Mobile wrapper
│   └── app/               # Native Android app source, build.gradle (versionCode & versionName)
│
├── scripts/               # Automation & tooling
│   └── import_letterboxd.mjs # Browser automation to scrape Letterboxd lists & enrich with TMDB
│
├── collections/           # Pre-built / imported collection JSONs in MongoDB schema
├── MCP/                   # Local Model Context Protocol server (server.js, memory.md)
├── Kartoons/              # Kartoons Android companion app
├── graphify-out/          # Codebase AST knowledge graph and analysis cache
├── .github/workflows/     # CI/CD: build-apps.yml (Builds signed Android APK & Windows EXE)
└── package.json           # Root scripts and workspace configuration
```

---

## 2. Quick Setup on a New Machine

### Prerequisites
- **Node.js**: v22.x or higher
- **Go**: v1.22 or higher
- **Git**: Installed and configured

### Step 1: Install Node Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Create a `.env` file in the repository root:
```env
# MongoDB Atlas
_MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
_MONGODB_DB_NAME=tmdb
MONGODB_URI=mongodb://localhost:27017/
MONGODB_DB_NAME=test

# Server
PORT=3001
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173

# TMDB
TMDB_API_KEY=6598875eb367b5334ad543e204fbda47
TMDB_BEARER_TOKEN=eyJhbGciOiJIUzI1NiJ9...
```

And in `backend-go/.env`:
```env
PORT=3001
MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
DB_NAME=tmdb
JWT_SECRET=your-super-secret-jwt-key
TMDB_BASE_URL=https://api.tmdb.org
TMDB_BEARER_TOKEN=eyJhbGciOiJIUzI1NiJ9...
CORS_ORIGIN=*
```

### Step 3: Run the Development Servers

#### Option A: Run Full Stack Concurrently
```bash
npm run dev
```

#### Option B: Run Individually
- **Frontend (Vite on http://localhost:5173)**:
  ```bash
  npm run dev:client
  ```
- **Backend (Go API on http://localhost:3001)**:
  ```bash
  cd backend-go
  go run cmd/server/main.go
  ```

---

## 3. Essential Commands

| Task | Command |
|---|---|
| **Build Web SPA** | `npm run build` |
| **Run Go Backend Tests** | `cd backend-go && go test ./...` |
| **Sync Capacitor Android** | `npx cap sync android` |
| **Import Letterboxd List** | `npm run import:letterboxd -- <url> [--browser] [--pages=1]` |
| **Import to MongoDB** | `npm run import:letterboxd -- <url> --username=<user> --collection="List Name"` |
| **Run MCP Server** | `node MCP/server.js` |

---

## 4. Key Architectural Patterns & Rules

### A. Collection Movie Schema in MongoDB
When storing movies into user collections in MongoDB, the exact document format is:
```javascript
{
  movieId: 24,              // Number (TMDB ID for movies, null for series)
  seriesId: null,           // Number (TMDB ID for series, null for movies)
  id: 24,                   // Number (TMDB ID)
  title: 'Kill Bill: Vol. 1',
  poster_path: '/v7TaX8kXMXs5yFFGR41guUDNcnB.jpg',    // TMDB relative path with leading slash
  backdrop_path: '/iffzIhuLAO38Po6sh1s6ZEVwlNL.jpg',  // TMDB relative path with leading slash
  release_date: '2003-10-10',
  first_air_date: '',
  media_type: 'Movie',      // 'Movie' or 'Series'
  isAnime: false,           // boolean (required for Collections Anime filter)
  vote_average: 7.97,       // float
  imdb_id: 'tt0266697',     // string
  imdb_rating: 8.2,         // float or null
  addedAt: '2026-10-26T17:26:12.700Z' // ISO Date string
}
```

### B. TV & Spatial Navigation
- Soulstash runs on Smart TVs (Android TV, Fire TV) via D-pad remote navigation.
- Focusable items require `data-card` or standard focusable elements (`button`, `a`).
- Shelves use `HOME_GRID_CLASS` and `useHomeTwoRowLimit()` (1 row on mobile/TV, 2 rows on desktop).
- Hardware Back button / Remote Back on the Home page (`/`) exits the application (`CapApp.exitApp()`).

### C. Details Page Constraints
- Watched & Watchlist buttons on the Content Details Page (`DetailPage.jsx`) must remain completely untouched in styling and core handler logic.

### D. Render.com Deployment for Backend
When setting up or updating the Render service for `soulstash-backend`:
- **Repository**: Connect to `ravan-001/Soulstash1`
- **Root Directory**: `backend-go`
- **Build Command**: `go build -o server ./cmd/server`
- **Start Command**: `./server`
- **Health Check Path**: `/health`

---

## 5. Automation: Letterboxd to TMDB Importer
To import any movie list from Letterboxd:
```bash
# Watch the browser open live and scrape:
npm run import:letterboxd -- https://letterboxd.com/films/popular/ --browser

# Scrape 3 pages and save directly into MongoDB user collection:
npm run import:letterboxd -- https://letterboxd.com/jack/list/official-top-250-films-with-the-most/ --pages=3 --username="your_user" --collection="Letterboxd Top 250"
```
Output JSON is stored in `collections/<slug>.json` in the exact MongoDB schema.
