import { BookCreatorMediaController } from './book-creator-media-controller';
import { BookElement } from '../../../core/book.model';

describe('BookCreatorMediaController: the answer key uploader, like a topic item', () => {
  let creator: any;
  let controller: BookCreatorMediaController;
  let saves: number;
  let element: BookElement;
  const blob = (name: string) => ({ name } as unknown as Blob);

  beforeEach(() => {
    saves = 0;
    creator = {
      book: { id: 'book-1' },
      assetUrlCache: new Map<string, string>(),
      bookLibrary: {
        getAssetUrl: (_id: string, path: string) => `noprep-book://book-1/${path}`,
        saveAssetData: async () => {
          saves++;
          return { relativePath: `assets/images/new-${saves}.jpg`, fileName: `new-${saves}.jpg` };
        }
      },
      blobToDataUrl: async () => 'data:image/jpeg;base64,AAAA',
      captureHistory: () => {},
      refreshElementAssetChange: () => {}
    };
    controller = new BookCreatorMediaController(creator);
    element = {
      id: 'key-1', type: 'answerKey',
      data: { images: ['assets/images/a.jpg', 'assets/images/b.jpg'], imageAudios: ['assets/audio/a.wav', null] }
    } as unknown as BookElement;
  });

  it('shows the selected picture, and a new one replaces it while its audio stays', async () => {
    controller.selectAnswerKeyImage(element, 0);
    expect(controller.isAddingAnswerKeyImage(element)).toBe(false);

    const cropped = blob('cropped');
    await controller.onAnswerKeyUploaderImage(cropped, element);
    expect(element.data['images']).toEqual(['assets/images/new-1.jpg', 'assets/images/b.jpg']);
    expect(element.data['imageAudios']).toEqual(['assets/audio/a.wav', null]);
    // Handed back to the uploader unchanged, so it is not emitted again.
    expect(controller.getAnswerKeyUploaderImage(element)).toBe(cropped);
  });

  it('with ＋ chosen, adds a picture and selects it', async () => {
    controller.selectAnswerKeyImage(element, 0);
    controller.startAddingAnswerKeyImage(element);
    expect(controller.isAddingAnswerKeyImage(element)).toBe(true);
    expect(controller.getAnswerKeyUploaderImage(element)).toBeNull();

    await controller.onAnswerKeyUploaderImage(blob('third'), element);
    expect(element.data['images']).toEqual(['assets/images/a.jpg', 'assets/images/b.jpg', 'assets/images/new-1.jpg']);
    expect(controller.isAddingAnswerKeyImage(element)).toBe(false);
    expect(controller.getSelectedAnswerKeyImageIndex(element)).toBe(2);
  });

  it('✕ in the uploader removes the selected picture with its audio', async () => {
    controller.selectAnswerKeyImage(element, 0);
    await controller.onAnswerKeyUploaderImage(null, element);
    expect(element.data['images']).toEqual(['assets/images/b.jpg']);
    expect(element.data['imageAudios']).toEqual([null]);
  });

  it('an answer key with no picture yet just adds', () => {
    const empty = { id: 'key-2', type: 'answerKey', data: { images: [] } } as unknown as BookElement;
    expect(controller.isAddingAnswerKeyImage(empty)).toBe(true);
  });
});
