import { AiTopicRequest, DEFAULT_READING_TASKS, buildAiTopicSystemPrompt, buildAiTopicUserText } from './ai-topic-prompt';
import { AI_RECIPE_GROUPS, AI_TOPIC_RECIPES, LESSON_PACK_BOXES, findRecipe } from './ai-topic-recipes';

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

  it('gives a two-sided chip its default side, or the one the teacher picked', () => {
    const findWord = buildAiTopicUserText({ ...base, recipe: 'gapFill' });
    expect(findWord).toContain('text = the missing word');
    expect(findWord).not.toContain('text = the sentence with "____"');

    const findCard = buildAiTopicUserText({ ...base, recipe: 'gapFill', recipeVariant: 'findCard' });
    expect(findCard).toContain('text = the sentence with "____"');
    expect(findCard).not.toContain('text = the missing word');

    expect(buildAiTopicUserText({ ...base, recipe: 'qa' })).toContain('text = the question');
    expect(buildAiTopicUserText({ ...base, recipe: 'qa', recipeVariant: 'findWord' })).toContain('text = the answer');
  });

  it('ignores a side for chips that have none', () => {
    expect(buildAiTopicUserText({ ...base, recipe: 'translation', recipeVariant: 'findCard' })).toContain(findRecipe('translation')!.instructions);
  });

  it('lists the speaking parts to make, from the materials or written by the AI', () => {
    const text = buildAiTopicUserText({
      ...base,
      recipe: 'speaking',
      speakingTest: {
        exam: 'movers',
        parts: [
          { type: 'STORY', count: 4, fromMaterials: true },
          { type: 'ODD', count: 3, fromMaterials: false }
        ]
      }
    });
    expect(text).toContain(findRecipe('speaking')!.instructions);
    expect(text).toContain('Speaking test (Talk Show) for A1 Movers');
    expect(text).toContain('- STORY: 4 pictures (from the materials)');
    expect(text).toContain('- ODD: 3 sets (write it)');
    expect(buildAiTopicUserText(base)).not.toContain('Speaking test (Talk Show)');
  });

  it('puts every chip under one of the four headings', () => {
    const groups = new Set(AI_RECIPE_GROUPS.map(group => group.id));
    expect(AI_TOPIC_RECIPES.length).toBe(15);
    expect(AI_TOPIC_RECIPES.every(recipe => groups.has(recipe.group))).toBe(true);
    expect(AI_TOPIC_RECIPES.filter(recipe => recipe.variants).map(recipe => recipe.id)).toEqual(['gapFill', 'qa']);
  });
});
