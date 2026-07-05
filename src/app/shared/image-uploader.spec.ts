import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { expect, vi } from 'vitest';

import { ImageUploaderComponent } from './image-uploader';
import { PixabayResponse, PixabayService } from '../core/pixabay';

describe('ImageUploaderComponent', () => {
  let component: ImageUploaderComponent;
  let fixture: ComponentFixture<ImageUploaderComponent>;
  let pixabayService: PixabayService;
  let searchSpy: ReturnType<typeof vi.fn>;
  let clearCacheSpy: ReturnType<typeof vi.fn>;

  const mockResponse: PixabayResponse = {
    total: 1,
    totalHits: 1,
    hits: [
      {
        id: 1,
        pageURL: '',
        type: 'photo',
        tags: 'cat',
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
        downloads: 1,
        collections: 0,
        likes: 0,
        comments: 0,
        user_id: 123,
        user: 'user',
        userImageURL: ''
      }
    ]
  };

  beforeEach(async () => {
    searchSpy = vi.fn(() => of(mockResponse));
    clearCacheSpy = vi.fn();
    pixabayService = {
      searchImages: searchSpy,
      clearCache: clearCacheSpy
    } as unknown as PixabayService;

    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule],
      declarations: [ImageUploaderComponent],
      providers: [{ provide: PixabayService, useValue: pixabayService }]
    }).compileComponents();

    fixture = TestBed.createComponent(ImageUploaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).electronAPI;
  });

  it('searches when the query meets the minimum length', async () => {
    searchSpy.mockReturnValue(of(mockResponse));

    component.searchControl.setValue('cat');
    await vi.runAllTimersAsync();

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('cat', expect.objectContaining({ page: 1 }));
    expect(component.searchResults).toEqual(mockResponse.hits);
  });

  it('shows an error message when the search fails', async () => {
    searchSpy.mockReturnValue(throwError(() => new Error('boom')));

    component.searchControl.setValue('dog');
    await vi.runAllTimersAsync();

    expect(component.searchError).toBe('Image search failed. Try again later.');
    expect(component.searchResults).toEqual([]);
  });

  it('appends additional hits when loadMore is triggered', async () => {
    const additionalHit = {
      id: 2,
      pageURL: '',
      type: 'photo',
      tags: 'cat',
      previewURL: 'preview2.jpg',
      previewWidth: 100,
      previewHeight: 100,
      webformatURL: 'web2.jpg',
      webformatWidth: 200,
      webformatHeight: 200,
      largeImageURL: 'large2.jpg',
      imageWidth: 400,
      imageHeight: 400,
      imageSize: 1000,
      views: 0,
      downloads: 0,
      collections: 0,
      likes: 0,
      comments: 0,
      user_id: 0,
      user: '',
      userImageURL: ''
    };
    component.searchControl.setValue('cat');
    await vi.runAllTimersAsync();

    component.searchResults = [...mockResponse.hits];
    (component as any).totalHits = 2;
    (component as any).searchPage = 1;
    component.canLoadMore = true;

    searchSpy.mockReturnValue(
      of({
        total: 2,
        totalHits: 2,
        hits: [additionalHit]
      })
    );

    component.loadMorePixabayImages();
    await vi.runAllTimersAsync();

    expect(searchSpy).toHaveBeenCalledWith('cat', expect.objectContaining({ page: 2 }));
    expect(component.searchResults.length).toBe(2);
  });

  it('opens Google Images through the Electron external URL bridge', async () => {
    const openExternalUrl = vi.fn(() => Promise.resolve(true));
    (window as any).electronAPI = { openExternalUrl };
    vi.spyOn((component as any).platform, 'isElectron').mockReturnValue(true);
    component.googleSearchControl.setValue('classroom cat');

    await component.openGoogleImages();

    expect(openExternalUrl).toHaveBeenCalledWith('https://www.google.com/search?tbm=isch&q=classroom%20cat');
  });
});
