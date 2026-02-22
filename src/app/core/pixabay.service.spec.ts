import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PixabayResponse, PixabayService } from './pixabay';

describe('PixabayService', () => {
  let service: PixabayService;
  let httpMock: HttpTestingController;

  const mockResponse: PixabayResponse = {
    total: 1,
    totalHits: 1,
    hits: [
      {
        id: 123,
        pageURL: '',
        type: 'photo',
        tags: '',
        previewURL: 'preview.jpg',
        previewWidth: 100,
        previewHeight: 100,
        webformatURL: 'web.jpg',
        webformatWidth: 200,
        webformatHeight: 200,
        largeImageURL: 'large.jpg',
        imageWidth: 400,
        imageHeight: 400,
        imageSize: 1000,
        views: 10,
        downloads: 5,
        collections: 1,
        likes: 2,
        comments: 0,
        user_id: 1,
        user: 'user',
        userImageURL: ''
      }
    ]
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PixabayService]
    });

    service = TestBed.inject(PixabayService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should cache identical requests and share the response', () => {
    let firstResponse: PixabayResponse | undefined;
    let secondResponse: PixabayResponse | undefined;

    service.searchImages('cat').subscribe(res => (firstResponse = res));
    const req = httpMock.expectOne(request => request.url === 'https://pixabay.com/api/');
    req.flush(mockResponse);

    expect(firstResponse).toEqual(mockResponse);
    service.searchImages('cat').subscribe(res => (secondResponse = res));
    httpMock.expectNone(request => request.url === 'https://pixabay.com/api/');
    expect(secondResponse).toEqual(mockResponse);

    service.clearCache();
    service.searchImages('cat').subscribe();
    httpMock.expectOne(request => request.url === 'https://pixabay.com/api/');
  });

  it('returns an empty response when the HTTP call fails', () => {
    let response: PixabayResponse | undefined;

    service.searchImages('error-case').subscribe(res => (response = res));
    const req = httpMock.expectOne(request => request.url === 'https://pixabay.com/api/');
    req.flush({}, { status: 500, statusText: 'Server Error' });

    expect(response).toEqual({ total: 0, totalHits: 0, hits: [] });
  });
});
