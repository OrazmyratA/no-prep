import { AiTopicRequest, DEFAULT_READING_TASKS, buildAiTopicSystemPrompt, buildAiTopicUserText } from './ai-topic-prompt';
import { AI_TOPIC_RECIPES, LESSON_PACK_BOXES, findRecipe } from './ai-topic-recipes';

const base: AiTopicRequest = {
  prompt: 'Here is a reading text.',
  pageCount: 0,
  itemCount: null,
  images: 'auto',
  audio: 'auto',
  existingItems: [],
  teacherLanguage: 'English',
  level: 'B1'
};

describe('ai-topic-prompt', () => {
  it('lists the Reading Detective tasks the teacher ticked', () => {
    const text = buildAiTopicUserText({ ...base, readingTasks: { ...DEFAULT_READING_TASKS, keys: false, gapped: 3 } });
    expect(text).toContain('Level: B1 (Cambridge B1 Preliminary (PET))');
    expect(text).toContain('- Key words in [ ]: no');
    expect(text).toContain('- True/False/Not given (TFNG or YNNG): 5 statements');
    expect(text).toContain('- Multiple choice (MC): none');
    expect(text).toContain('- Gapped text: 3 sentences taken out');
  });

  it('says nothing about tasks outside reading mode', () => {
    expect(buildAiTopicUserText(base)).not.toContain('Reading Detective');
  });

  it('explains every task syntax in the system prompt', () => {
    const prompt = buildAiTopicSystemPrompt();
    for (const tag of ['? TFNG', '? YNNG', '? MC', '? WORD', '? EXTRA', '"~ "']) {
      expect(prompt).toContain(tag);
    }
  });

  it('adds the expert rules of the chip the teacher picked', () => {
    const text = buildAiTopicUserText({ ...base, recipe: 'gapFill' });
    expect(text).toContain('The teacher picked a ready-made task');
    expect(text).toContain('Gap-fill topic');
    expect(text).not.toContain('Opposites topic');
  });

  it('adds no recipe rules for a free request or an unknown recipe', () => {
    expect(buildAiTopicUserText(base)).not.toContain('ready-made task');
    expect(buildAiTopicUserText({ ...base, recipe: null })).not.toContain('ready-made task');
    expect(buildAiTopicUserText({ ...base, recipe: 'nope' as never })).not.toContain('ready-made task');
  });

  it('has rules for every chip, and the text recipes write a text when there is none', () => {
    for (const recipe of AI_TOPIC_RECIPES) {
      expect(recipe.instructions.length).toBeGreaterThan(40);
    }
    expect(findRecipe('reading')!.instructions).toContain('WRITE one yourself');
    expect(findRecipe('writing')!.instructions).toContain('WRITE one yourself');
    expect(LESSON_PACK_BOXES.map(box => findRecipe(box.recipe)?.id)).toEqual(['pages', 'sentences', 'reading', 'writing']);
  });
});
