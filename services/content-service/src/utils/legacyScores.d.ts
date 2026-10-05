export declare const INDIAN_LANGS: Set<string>;
export declare function normalizeText(str?: string): string;
export declare function computeFinalScore(item: any, query: string, year_query: string | null): number;
export declare function normalize(item: any, type: string): {
    id: any;
    type: string;
    media_type: string;
    title: any;
    originalTitle: any;
    poster_path: any;
    backdrop_path: any;
    release_date: any;
    release_year: number | null;
    originalLanguage: any;
    originCountry: any;
    voteCount: any;
    voteAverage: any;
    popularity: any;
};
export declare function normalizePerson(person: any): {
    id: any;
    media_type: string;
    title: any;
    name: any;
    poster_path: any;
    profile_path: any;
    known_for_department: any;
};
export declare function normalizeUser(user: any): {
    id: string;
    _id: string;
    media_type: string;
    title: any;
    name: any;
    username: any;
    poster_path: any;
    profile_path: any;
    avatar: any;
    fullName: any;
    bio: any;
};
export declare function isIndianPerson(person: any): any;
//# sourceMappingURL=legacyScores.d.ts.map