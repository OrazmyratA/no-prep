import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { TopicFormComponent } from './topic-form';
import { DbService } from '../../../core/db';
import { LicenseService } from '../../../core/license';
import { AiPageHandoffService } from '../../../core/ai-topic/ai-page-handoff.service';

// Plain fakes that record their calls (no mocking library needed).
class FakeDb {
  calls: { method: string; args: unknown[] }[] = [];
  failNextAddItems = false;

  async createTopic(name: string) {
    this.calls.push({ method: 'createTopic', args: [name] });
    return 7;
  }
  async addItems(topicId: number, items: unknown[]) {
    this.calls.push({ method: 'addItems', args: [topicId, items] });
    if (this.failNextAddItems) {
      this.failNextAddItems = false;
      throw new Error('QuotaExceededError');
    }
  }
  async updateTopic(id: number, name: string) {
    this.calls.push({ method: 'updateTopic', args: [id, name] });
  }
  async updateItems(topicId: number, items: unknown[]) {
    this.calls.push({ method: 'updateItems', args: [topicId, items] });
  }
  called(method: string) {
    return this.calls.filter(call => call.method === method);
  }
}

describe('TopicForm', () => {
  let component: TopicFormComponent;
  let fixture: ComponentFixture<TopicFormComponent>;
  let fakeDb: FakeDb;
  let navigations: unknown[][];

  beforeEach(async () => {
    fakeDb = new FakeDb();
    navigations = [];
    await TestBed.configureTestingModule({
      declarations: [TopicFormComponent],
      providers: [
        { provide: DbService, useValue: fakeDb },
        { provide: Router, useValue: { navigate: (commands: unknown[]) => navigations.push(commands) } },
        { provide: LicenseService, useValue: { fullAccess: true, requestReopen: () => {} } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(TopicFormComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  function addItem(text: string) {
    component.items.push(component.createItemFormGroup(null, text));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('drops accidental blank items instead of refusing to save', async () => {
    component.topicForm.patchValue({ name: 'Fruits' });
    addItem('apple');
    addItem('');
    addItem('pear');

    await component.onSubmit();

    expect(fakeDb.called('createTopic').map(call => call.args)).toEqual([['Fruits']]);
    const saved = fakeDb.called('addItems')[0].args[1] as { text: string }[];
    expect(saved.map(item => item.text)).toEqual(['apple', 'pear']);
    expect(navigations).toEqual([['/topics', 7, 'activities']]);
  });

  it('does not save without a name and marks the name field', async () => {
    addItem('apple');

    await component.onSubmit();

    expect(fakeDb.calls.length).toBe(0);
    expect(component.nameMissingShown).toBe(true);
    expect(component.saving).toBe(false);
  });

  it('keeps a single blank item so the form is never emptied', async () => {
    component.topicForm.patchValue({ name: 'Empty' });
    addItem('');
    const itemCount = component.items.length;

    await component.onSubmit();

    expect(fakeDb.calls.length).toBe(0);
    expect(component.items.length).toBe(itemCount);
  });

  it('opens "Create with AI" with pages handed over from a book marker, once', async () => {
    const handoff = TestBed.inject(AiPageHandoffService);
    const page = new Blob(['page']);
    handoff.give([page]);
    component.ngOnInit();
    expect(component.aiPanelOpen).toBe(true);
    expect(component.aiInitialPages).toEqual([page]);
    expect(handoff.take()).toEqual([]);
  });

  it('keeps "Create with AI" folded on a new topic until ✨ is clicked', () => {
    expect(component.aiPanelOpen).toBe(false);
    expect(component.aiPanelCreated).toBe(false);
    component.toggleAiPanel();
    expect(component.aiPanelOpen).toBe(true);
    component.toggleAiPanel();
    expect(component.aiPanelOpen).toBe(false);
    // Still made: what the teacher typed in it stays while it is folded.
    expect(component.aiPanelCreated).toBe(true);
  });

  describe('⇄ swap text and cards', () => {
    const voice = new Blob(['voice of elephant']);

    beforeEach(() => {
      // Word cards are drawn on a canvas, which jsdom has not got.
      (component as any).aiMedia.wordCard = async (words: string) => Object.assign(new Blob([]), { words });
      component.items.clear();
      component.items.push(component.createItemFormGroup(null, 'elephant', new Blob(['card']), voice,
        { audioSource: voice, audioText: 'elephant', imageText: 'a very big grey animal' }));
      component.items.push(component.createItemFormGroup(null, 'cat', new Blob(['photo'])));
      component.items.push(component.createItemFormGroup(null, '# Animals', new Blob(['card']), null, { imageText: 'Animals' }));
    });

    it('swaps only items with a word card and plain text, and sets their voice aside', async () => {
      expect(component.canSwapSides).toBe(true);
      await component.swapSides();

      const [word, photo, heading] = component.items.controls.map(item => item.value);
      expect(word.text).toBe('a very big grey animal');
      expect(word.imageText).toBe('elephant');
      expect(word.image.words).toBe('elephant');
      // The old voice would say the answer now.
      expect(word.audio).toBeNull();
      expect(photo.text).toBe('cat');
      expect(heading.text).toBe('# Animals');
      expect(component.swapResult?.swapped).toBe(1);
      expect(component.swapResult?.kept).toBe(1);
      expect(component.swapResult?.needVoice.length).toBe(1);
    });

    it('swapping back brings the first voice back, at no cost', async () => {
      await component.swapSides();
      await component.swapSides();

      const word = component.items.at(0).value;
      expect(word.text).toBe('elephant');
      expect(word.imageText).toBe('a very big grey animal');
      expect(word.audio).toBe(voice);
      expect(word.audioText).toBe('elephant');
      expect(component.swapResult?.needVoice.length).toBe(0);
      expect(component.swapResult?.back).toBe(true);
    });

    it('is not offered when no item has a word card', () => {
      component.items.removeAt(2);
      component.items.removeAt(0);
      expect(component.canSwapSides).toBe(false);
    });
  });

  it('retries a half-finished save as an update, not a second topic', async () => {
    component.topicForm.patchValue({ name: 'Fruits' });
    addItem('apple');
    fakeDb.failNextAddItems = true;

    await component.onSubmit();
    expect(component.saving).toBe(false);
    expect(navigations.length).toBe(0);

    await component.onSubmit();
    expect(fakeDb.called('createTopic').length).toBe(1);
    expect(fakeDb.called('updateTopic').map(call => call.args)).toEqual([[7, 'Fruits']]);
    expect(fakeDb.called('updateItems').length).toBe(1);
    expect(navigations).toEqual([['/topics', 7, 'activities']]);
  });
});
