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

  it('opens the Google Images home page through Electron when there is no query', async () => {
    const openExternalUrl = vi.fn(() => Promise.resolve(true));
    (window as any).electronAPI = { openExternalUrl };
    vi.spyOn((component as any).platform, 'isElectron').mockReturnValue(true);
    component.googleSearchControl.setValue('');

    await component.openGoogleImages();

    expect(openExternalUrl).toHaveBeenCalledWith('https://www.google.com/imghp');
  });

  describe('manual crop', () => {
    // Both entry points must offer the SAME full set (current picture + every attached page):
    // the AI's pick might not be from a page even when pages exist, and a page-sourced pick's
    // original page must stay reachable — neither button may show a partial picture.
    const clickEvent = () => new MouseEvent('click');

    it('puts the current picture first, with every attached page after it, labelled', () => {
      (component as any).previewSource = new Blob(['current']);
      component.pageSources = [new Blob(['p1']), new Blob(['p2'])];

      component.openCrop(clickEvent());

      expect(component.cropDialogOpen).toBe(true);
      expect(component.cropImages).toEqual([(component as any).previewSource, ...component.pageSources]);
      expect(component.cropLabels).toEqual(['Current picture', 'Page 1', 'Page 2']);
      expect(component.cropStartIndex).toBe(0);
    });

    it('offers just the pages when there is no current picture', () => {
      (component as any).previewSource = null;
      component.pageSources = [new Blob(['p1'])];

      component.openCrop(clickEvent());

      expect(component.cropImages).toEqual(component.pageSources);
      expect(component.cropLabels).toEqual(['Page 1']);
    });

    it('does nothing when there is neither a current picture nor any attached pages', () => {
      (component as any).previewSource = null;
      component.pageSources = [];
      component.openCrop(clickEvent());
      expect(component.cropDialogOpen).toBe(false);
    });

    it('emits the cropped result on its own event, not imageSelected', () => {
      // A crop refines the current picture, it isn't the teacher rejecting it the way picking a
      // different image/upload is — topic-form relies on this distinction to keep its
      // "another picture"/"generate a picture" buttons working after a crop.
      const cropped = new Blob(['cropped']);
      const onImageSelected: (Blob | null)[] = [];
      const onImageCropped: Blob[] = [];
      component.imageSelected.subscribe(b => onImageSelected.push(b));
      component.imageCropped.subscribe(b => onImageCropped.push(b));

      component.cropDialogOpen = true;
      component.onCropped(cropped);

      expect(component.cropDialogOpen).toBe(false);
      expect(onImageCropped).toEqual([cropped]);
      expect(onImageSelected).toEqual([]);
    });

    it('closes without changing the image when the crop is cancelled', () => {
      component.cropDialogOpen = true;
      component.onCropCancelled();
      expect(component.cropDialogOpen).toBe(false);
    });
  });
});
