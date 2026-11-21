import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TMDB_API_KEY = '6598875eb367b5334ad543e204fbda47';

const LISTS = [
  {
    name: 'Letterboxd Official Top 250',
    slug: 'letterboxd-top-250',
    description: 'The highest-rated narrative feature films on Letterboxd of all time.',
    source: 'https://letterboxd.com/jack/list/official-top-250-films-with-the-most/',
    bannerMovieId: 238, // The Godfather
    movieIds: [
      238, 278, 240, 389, 424, 129, 496243, 680, 155, 550,
      157336, 27205, 346, 14537, 769, 324857, 569094, 598, 637, 11216,
      244786, 122, 120, 121, 1891, 510, 289, 539, 567, 28,
      348, 679, 694, 78, 335984, 62, 603, 280, 105, 329,
      275, 6977, 7345, 38, 545611, 467244, 915935, 872585, 313369, 792307
    ]
  },
  {
    name: 'Best of A24 Ranked',
    slug: 'best-of-a24',
    description: 'The finest and most critically acclaimed films produced and distributed by A24.',
    source: 'https://letterboxd.com/crew/list/a24/',
    bannerMovieId: 545611, // Everything Everywhere All at Once
    movieIds: [
      545611, 666277, 503919, 493922, 530385, 391713, 376867, 965150, 473033,
      407436, 264660, 467244, 792307, 785538, 522924, 804435, 499701, 35056,
      378236, 426284, 550231, 714968, 693134, 1064213, 1007826
    ]
  },
  {
    name: 'Studio Ghibli Complete Collection',
    slug: 'studio-ghibli',
    description: 'Every magical animated masterpiece from legendary director Hayao Miyazaki and Studio Ghibli.',
    source: 'https://letterboxd.com/crew/list/studio-ghibli-ranked/',
    bannerMovieId: 129, // Spirited Away
    movieIds: [
      129, 128, 4935, 8392, 12477, 16859, 149870, 10515, 12429, 508883,
      37797, 89333, 15370, 11658, 83389, 10838, 140300, 39881, 149, 15171
    ]
  },
  {
    name: 'Sight & Sound Critics Greatest Films',
    slug: 'sight-and-sound-greatest',
    description: 'The greatest films of all time as voted by international film critics in the decennial Sight & Sound poll.',
    source: 'https://letterboxd.com/bfi/list/sight-and-sound-2022-critics-top-100/',
    bannerMovieId: 62, // 2001: A Space Odyssey
    movieIds: [
      238, 62, 78, 289, 539, 567, 346, 28, 680, 550,
      129, 155, 157336, 510, 240, 389, 424, 769, 1891, 105
    ]
  },
  {
    name: '1001 Movies You Must See Before You Die',
    slug: '1001-movies-must-see',
    description: 'Essential cinema classics and defining masterpieces selected from the iconic reference book.',
    source: 'https://letterboxd.com/peterovh/list/1001-movies-you-must-see-before-you-die/',
    bannerMovieId: 680, // Pulp Fiction
    movieIds: [
      680, 238, 155, 550, 157336, 27205, 348, 694, 78, 603,
      280, 329, 275, 6977, 7345, 38, 545611, 872585, 313369, 244786,
      28, 120, 121, 122, 1891, 510, 289, 539, 567, 637
    ]
  },
  {
    name: 'Top Sci-Fi Masterpieces',
    slug: 'top-scifi-masterpieces',
    description: 'Letterboxd highest-rated science fiction films spanning mind-bending journeys and dystopian futures.',
    source: 'https://letterboxd.com/crew/list/top-50-sci-fi-films/',
    bannerMovieId: 157336, // Interstellar
    movieIds: [
      157336, 27205, 62, 78, 335984, 603, 348, 679, 280, 105,
      329, 545611, 324857, 569094, 693134, 438631, 264660, 1891, 38, 11
    ]
  },
  {
    name: 'Top Horror Masterpieces',
    slug: 'top-horror-masterpieces',
    description: 'The terrifying, atmospheric, and psychological horror benchmarks rated highest on Letterboxd.',
    source: 'https://letterboxd.com/crew/list/top-50-horror-films/',
    bannerMovieId: 694, // The Shining
    movieIds: [
      694, 348, 1091, 539, 493922, 419430, 8077, 274, 948, 77,
      530385, 503919, 703, 710, 565, 423204, 375588, 310131, 945961, 933260
    ]
  },
  {
    name: 'Letterboxd Fan Favorites (2024–2025)',
    slug: 'fan-favorites-2024-2025',
    description: 'The most popular, viral, and critically adored releases of recent cinema.',
    source: 'https://letterboxd.com/crew/list/best-of-2024/',
    bannerMovieId: 693134, // Dune: Part Two
    movieIds: [
      693134, 786892, 937287, 1064213, 933260, 823219, 1079524, 945961,
      872585, 346698, 792307, 915935, 840430, 467244, 965150, 569094,
      1022789, 519182, 1022796, 601796
    ]
  }
];

async function fetchMovie(id) {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      movieId: d.id,
      seriesId: null,
      id: d.id,
      title: d.title,
      poster_path: d.poster_path || '',
      backdrop_path: d.backdrop_path || '',
      release_date: d.release_date || '',
      first_air_date: '',
      media_type: 'Movie',
      isAnime: d.original_language === 'ja' && (d.genres || []).some(g => g.id === 16),
      vote_average: Number((d.vote_average || 0).toFixed(2)),
      imdb_id: d.imdb_id || '',
      imdb_rating: null,
      addedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error(`Failed movie ${id}:`, e.message);
    return null;
  }
}

async function run() {
  const outDir = path.join(ROOT_DIR, 'collections', 'letterboxd');
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];

  for (const list of LISTS) {
    console.log(`Processing ${list.name}...`);
    const movies = [];
    let banner = '';

    for (const id of list.movieIds) {
      const m = await fetchMovie(id);
      if (m) {
        movies.push(m);
        if (id === list.bannerMovieId && m.backdrop_path) {
          banner = `https://image.tmdb.org/t/p/w1280${m.backdrop_path}`;
        }
      }
      await new Promise(r => setTimeout(r, 60));
    }

    if (!banner && movies.length > 0 && movies[0].backdrop_path) {
      banner = `https://image.tmdb.org/t/p/w1280${movies[0].backdrop_path}`;
    }

    const payload = {
      name: list.name,
      slug: list.slug,
      source: list.source,
      description: list.description,
      banner,
      total_count: movies.length,
      movies
    };

    const filePath = path.join(outDir, `${list.slug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Saved ${list.slug}.json with ${movies.length} movies.`);

    summary.push({
      username: 'letterboxd',
      source: 'letterboxd',
      slug: list.slug,
      collection: {
        name: list.name,
        slug: list.slug,
        description: list.description,
        banner,
        movieCount: movies.length,
        movies
      }
    });
  }

  // Also include popular.json if present
  const popularPath = path.join(ROOT_DIR, 'collections', 'popular.json');
  if (fs.existsSync(popularPath)) {
    try {
      const popularData = JSON.parse(fs.readFileSync(popularPath, 'utf8'));
      const popularMovies = popularData.movies || [];
      const popularBanner = popularMovies.find(m => m.backdrop_path)?.backdrop_path || '';
      summary.unshift({
        username: 'letterboxd',
        source: 'letterboxd',
        slug: 'letterboxd-popular',
        collection: {
          name: 'Letterboxd Most Popular',
          slug: 'letterboxd-popular',
          description: 'The most logged, rewatched, and fan-favorite movies on Letterboxd worldwide.',
          banner: popularBanner ? `https://image.tmdb.org/t/p/w1280${popularBanner}` : '',
          movieCount: popularMovies.length,
          movies: popularMovies
        }
      });
    } catch (_) {}
  }

  const allSummaryPath = path.join(outDir, 'letterboxd_featured.json');
  fs.writeFileSync(allSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nGenerated all ${summary.length} Letterboxd featured collections in ${allSummaryPath}`);
}

run();
