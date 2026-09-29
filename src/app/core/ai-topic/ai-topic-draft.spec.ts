import { AI_TOPIC_MAX_ITEMS, AiItemDraft, parseAiTopicDraft } from './ai-topic-draft';
import { findPoorlySuitedGames } from './ai-topic-games';
import { buildAiTopicUserText } from './ai-topic-prompt';

function item(overrides: Partial<AiItemDraft>): AiItemDraft {
  return { text: '', imageKind: 'none', imageQuery: '', imageStyle: 'photo', audioText: '', ...overrides };
}

describe('parseAiTopicDraft', () => {
  it('reads a well-formed answer', () => {
    const draft = parseAiTopicDraft(JSON.stringify({
      topicName: 'Fruits',
      language: 'en-GB',
      notes: [],
      items: [{ text: 'apple', imageKind: 'search', imageQuery: 'red apple', imageStyle: 'photo', audioText: 'apple' }]
    }));
    expect(draft.topicName).toBe('Fruits');
    expect(draft.language).toBe('en-GB');
    expect(draft.items).toEqual([
      { text: 'apple', imageKind: 'search', imageQuery: 'red apple', imageStyle: 'photo', audioText: 'apple' }
    ]);
  });

  it('accepts JSON wrapped in code fences or prose', () => {
    const body = '{"topicName":"A","language":"en","notes":[],"items":[{"text":"cat"}]}';
    expect(parseAiTopicDraft('```json\n' + body + '\n```').items[0].text).toBe('cat');
    expect(parseAiTopicDraft('Here you go: ' + body + ' Enjoy!').items[0].text).toBe('cat');
  });

  it('repairs items instead of rejecting the whole draft', () => {
    const draft = parseAiTopicDraft({
      topicName: 'Linking words',
      items: [
        { text: 'however', imageKind: 'wordCard', imageQuery: '' },      // card falls back to the text
        { text: 'dog', imageKind: 'search', imageQuery: '' },            // search without query -> none
        { text: 'car', imageKind: 'banana', imageQuery: 'car' },         // unknown kind -> none
        { text: '', imageKind: 'none', audioText: '' },                  // empty -> dropped
        'garbage'
      ]
    });
    expect(draft.items.map(i => [i.text, i.imageKind, i.imageQuery])).toEqual([
      ['however', 'wordCard', 'however'],
      ['dog', 'none', ''],
      ['car', 'none', '']
    ]);
    expect(draft.notes).toEqual([]);
  });

  it('caps the number of items', () => {
    const items = Array.from({ length: AI_TOPIC_MAX_ITEMS + 5 }, (_, i) => ({ text: `w${i}` }));
    expect(parseAiTopicDraft({ items }).items.length).toBe(AI_TOPIC_MAX_ITEMS);
  });

  it('throws when nothing usable is left', () => {
    expect(() => parseAiTopicDraft('not json')).toThrow();
    expect(() => parseAiTopicDraft({ items: [] })).toThrow();
  });
});

describe('findPoorlySuitedGames', () => {
  it('flags sentence games for a plain vocabulary topic', () => {
    const items = ['apple', 'banana', 'orange'].map(text => item({ text, imageKind: 'search', imageQuery: text }));
    const poor = findPoorlySuitedGames(items);
    expect(poor).toContain('unjumble');
    expect(poor).not.toContain('anagram');
    expect(poor).not.toContain('line-trace-match');
  });

  it('flags spelling games for gap-fill sentences', () => {
    const items = [
      item({ text: 'I was tired. ____, I finished my homework.', imageKind: 'wordCard', imageQuery: 'however' }),
      item({ text: 'Cats ____ dogs: who wins?', imageKind: 'wordCard', imageQuery: 'vs' })
    ];
    const poor = findPoorlySuitedGames(items);
    for (const id of ['anagram', 'spelling-check', 'word-search', 'tracing', 'unjumble']) {
      expect(poor).toContain(id);
    }
    expect(poor).not.toContain('line-trace-match');
  });

  it('flags line trace match when items have no pictures', () => {
    expect(findPoorlySuitedGames([item({ text: 'a' }), item({ text: 'b' })])).toContain('line-trace-match');
  });
});

describe('buildAiTopicUserText', () => {
  it('lists existing items so the AI does not repeat them', () => {
    const text = buildAiTopicUserText({
      prompt: 'more fruits',
      pageCount: 0,
      itemCount: 5,
      images: 'auto',
      audio: 'off',
      existingItems: ['apple'],
      teacherLanguage: 'English'
    });
    expect(text).toContain('Number of items: 5');
    expect(text).toContain('Audio: none for any item.');
    expect(text).toContain('- apple');
  });
});
