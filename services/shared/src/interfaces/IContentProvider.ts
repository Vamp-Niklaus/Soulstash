export interface CategoryResult {
  movies: any[];
  totalPages: number;
}

export interface IContentProvider {
  getTrending(page?: number, limit?: number): Promise<any[]>;
  getGenres(): Promise<any[]>;
  getCategoryItems(genreId: string, page?: number, limit?: number): Promise<CategoryResult>;
  search(query: string, type?: string): Promise<any[]>;
  getRawTMDB(endpoint: string): Promise<any>;
}
