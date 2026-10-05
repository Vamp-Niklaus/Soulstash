"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDIAN_LANGS = void 0;
exports.normalizeText = normalizeText;
exports.computeFinalScore = computeFinalScore;
exports.normalize = normalize;
exports.normalizePerson = normalizePerson;
exports.normalizeUser = normalizeUser;
exports.isIndianPerson = isIndianPerson;
exports.INDIAN_LANGS = new Set([
    'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'gu', 'pa', 'ur'
]);
function normalizeText(str = '') {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function computeFinalScore(item, query, year_query) {
    let score = 0;
    const q = query.toLowerCase();
    const t1 = (item.title || '').toLowerCase();
    const t2 = (item.originalTitle || '').toLowerCase();
    // Exact title match (highest priority)
    if (t1 === q || t2 === q) {
        score += 200;
    }
    // Contains query (high priority)
    else if (t1.includes(q) || t2.includes(q)) {
        score += 100;
    }
    // Partial word match (medium priority)
    else if (t1.split(' ').some((word) => word.includes(q)) || t2.split(' ').some((word) => word.includes(q))) {
        score += 40;
    }
    // Penalty for missing critical data
    if (!item.title)
        score -= 50;
    if (!item.poster_path)
        score -= 30;
    // if (!item.overview) score -= 20;
    if (year_query && item.release_year === Number(year_query)) {
        score += 70; // HARD BOOST
    }
    // Indian priority (lowered)
    if (Array.isArray(item.originCountry) && item.originCountry.includes('IN')) {
        score += 50;
    }
    if (item.originalLanguage && exports.INDIAN_LANGS.has(item.originalLanguage)) {
        score += 15;
    }
    // Credibility (lowered)
    score += Math.min((item.voteCount || 0) / 200, 20);
    score += (item.voteAverage || 0);
    return score;
}
function normalize(item, type) {
    const isMovie = type === 'movie';
    const releaseDate = isMovie
        ? item.release_date
        : item.first_air_date;
    // Extract year safely from YYYY-MM-DD
    const releaseYear = releaseDate?.length >= 4
        ? Number(releaseDate.slice(0, 4))
        : null;
    return {
        id: item.id,
        type,
        media_type: isMovie ? 'Movie' : 'Series',
        title: item.title || item.name || '',
        originalTitle: item.original_title || item.original_name || '',
        // --- poster (IMPORTANT for frontend) ---
        poster_path: item.poster_path || null,
        backdrop_path: item.backdrop_path || null,
        release_date: releaseDate || null,
        release_year: releaseYear ?? null,
        originalLanguage: item.original_language || null,
        originCountry: item.origin_country || [],
        voteCount: item.vote_count || 0,
        voteAverage: item.vote_average || 0,
        popularity: item.popularity || 0
    };
}
function normalizePerson(person) {
    return {
        id: person.id,
        media_type: 'Person',
        title: person.name || '',
        name: person.name || '',
        poster_path: person.profile_path || null,
        profile_path: person.profile_path || null,
        known_for_department: person.known_for_department || 'Cast & Crew'
    };
}
function normalizeUser(user) {
    return {
        id: String(user._id),
        _id: String(user._id),
        media_type: 'User',
        title: user.username || user.fullName || '',
        name: user.fullName || user.username || '',
        username: user.username || '',
        poster_path: user.avatar || null,
        profile_path: user.avatar || null,
        avatar: user.avatar || null,
        fullName: user.fullName || '',
        bio: user.bio || ''
    };
}
function isIndianPerson(person) {
    const knownFor = Array.isArray(person?.known_for) ? person.known_for : [];
    return knownFor.some((item) => {
        const originCountry = Array.isArray(item?.origin_country) ? item.origin_country : [];
        const productionCountries = Array.isArray(item?.production_countries) ? item.production_countries : [];
        const productionIso = productionCountries.map((c) => c?.iso_3166_1).filter(Boolean);
        return originCountry.includes('IN') || productionIso.includes('IN') || exports.INDIAN_LANGS.has(item?.original_language);
    });
}
//# sourceMappingURL=legacyScores.js.map