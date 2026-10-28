import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiTopicPanelComponent } from './ai-topic-panel';
import { AiTopicService, pageBudgetMb } from '../../../core/ai-topic/ai-topic.service';
import { PdfPagesService } from '../../../core/ai-topic/pdf-pages';
import { AiChoicesService } from '../../../core/ai-topic/ai-choices';

function fakePdf(pageCount: number) {
  return {
    pageCount,
    renderPage: vi.fn(async (page: number) => new Blob([`page ${page}`], { type: 'image/jpeg' })),
    close: vi.fn(async () => {})
  };
}

describe('AiTopicPanelComponent PDF pages', () => {
  const openPdf = vi.fn();

  async function open(maxImages = 12) {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    await TestBed.configureTestingModule({
      declarations: [AiTopicPanelComponent],
      providers: [{ provide: PdfPagesService, useValue: { open: openPdf } }, {
        provide: AiTopicService,
        useValue: {
          isAvailable: true,
          getProviders: async () => [{ id: 'gemini', label: 'Gemini', keyPageUrl: '', configured: true, maxImages, supportsImageGeneration: true }],
          getSelectedProvider: () => 'gemini',
          setSelectedProvider: () => {}
        }
      }]
    }).compileComponents();
    const fixture = TestBed.createComponent(AiTopicPanelComponent);
    await fixture.componentInstance.ngOnInit();
    await TestBed.inject(AiChoicesService).loadProviders();
    return fixture.componentInstance;
  }

  const pdfFile = (name = 'unit5.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });
  const chooseFiles = (dialog: AiTopicPanelComponent, files: File[]) =>
    (dialog as unknown as { addFiles(files: File[]): Promise<void> }).addFiles(files);

  afterEach(() => {
    vi.restoreAllMocks();
    openPdf.mockReset();
  });

  it('adds every page of a short PDF as a page photo', async () => {
    const pdf = fakePdf(3);
    openPdf.mockResolvedValue(pdf);
    const dialog = await open();
    await chooseFiles(dialog, [pdfFile()]);
    expect(dialog.pages.length).toBe(3);
    expect(pdf.renderPage.mock.calls.map(call => call[0])).toEqual([1, 2, 3]);
    expect(pdf.close).toHaveBeenCalled();
    expect(dialog.pdfChoice).toBeNull();
  });

  it('asks which pages to read when the PDF is longer than the room left', async () => {
    const pdf = fakePdf(40);
    openPdf.mockResolvedValue(pdf);
    const dialog = await open(4);
    await chooseFiles(dialog, [pdfFile()]);
    expect(dialog.pages.length).toBe(0);
    expect(dialog.pdfChoice?.text).toBe('1-4');

    dialog.setPdfChoiceText('12-20');
    await dialog.confirmPdfChoice();
    expect(dialog.pdfChoice?.errorKey).toBe('creatorAiPagesTooMany');

    dialog.setPdfChoiceText('41');
    await dialog.confirmPdfChoice();
    expect(dialog.pdfChoice?.errorKey).toBe('aiTopicPdfOutOfRange');

    dialog.setPdfChoiceText('12-13, 15');
    await dialog.confirmPdfChoice();
    expect(pdf.renderPage.mock.calls.map(call => call[0])).toEqual([12, 13, 15]);
    expect(dialog.pages.length).toBe(3);
    expect(dialog.pdfChoice).toBeNull();
    expect(pdf.close).toHaveBeenCalled();
  });

  it('says so when a PDF cannot be opened', async () => {
    openPdf.mockRejectedValue(new Error('broken'));
    const dialog = await open();
    await chooseFiles(dialog, [pdfFile()]);
    expect(dialog.errorKey).toBe('aiTopicPdfFailed');
    expect(dialog.readingPdf).toBe(false);
  });

  it('shrinks each page more when many pages are sent', () => {
    expect(pageBudgetMb(1)).toBe(1);
    expect(pageBudgetMb(6)).toBe(1);
    expect(pageBudgetMb(12)).toBeCloseTo(7 / 12);
  });
});
