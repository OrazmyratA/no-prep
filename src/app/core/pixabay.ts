import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, shareReplay } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PixabayImage {
  id: number;
  pageURL: string;
  type: string;
  tags: string;
  previewURL: string;
  previewWidth: number;
  previewHeight: number;
  webformatURL: string;
  webformatWidth: number;
  webformatHeight: number;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  imageSize: number;
  views: number;
  downloads: number;
  collections: number;
  likes: number;
  comments: number;
  user_id: number;
  user: string;
  userImageURL: string;
}

export interface PixabayResponse {
  total: number;
  totalHits: number;
  hits: PixabayImage[];
}

export interface PixabaySearchOptions {
  perPage?: number;
  page?: number;
  imageType?: 'all' | 'photo' | 'illustration' | 'vector';
  order?: 'popular' | 'latest';
  safeSearch?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PixabayService {
  private readonly baseUrl = 'https://pixabay.com/api/';
  private readonly cache = new Map<string, Observable<PixabayResponse>>();

  constructor(private http: HttpClient) {}

  searchImages(query: string, options: PixabaySearchOptions = {}): Observable<PixabayResponse> {
    const params = new HttpParams()
      .set('key', environment.pixabayApiKey)
      .set('q', query)
      .set('image_type', options.imageType ?? 'all')
      .set('per_page', String(options.perPage ?? 24))
      .set('page', String(options.page ?? 1))
      .set('order', options.order ?? 'popular')
      .set('safesearch', String(options.safeSearch ?? true));

    const cacheKey = `${query}:${params.toString()}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const request$ = this.http.get<PixabayResponse>(this.baseUrl, { params }).pipe(
      catchError(() =>
        of({
          total: 0,
          totalHits: 0,
          hits: []
        })
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    this.cache.set(cacheKey, request$);
    return request$;
  }

  clearCache() {
    this.cache.clear();
  }
}
