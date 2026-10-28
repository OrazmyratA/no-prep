import { AI_TOPIC_RECIPES, findRecipe, recipeInstructions } from './ai-topic-recipes';

describe('ai-topic-recipes', () => {
  const twoSided = AI_TOPIC_RECIPES.filter(recipe => recipe.variants);

  it('lets teachers pick the side on every word chip with two sides', () => {
    expect(twoSided.map(recipe => recipe.id as string).sort()).toEqual(
      ['collocations', 'definitions', 'gapFill', 'qa', 'synonyms', 'translation', 'verbForms'].sort()
    );
  });

  it('gives every two-sided chip an example and a voice rule per side', () => {
    for (const recipe of twoSided) {
      expect(recipe.example?.word).toBeTruthy();
      expect(recipe.example!.clue || recipe.example!.clueKey).toBeTruthy();
      for (const variant of ['findWord', 'findCard'] as const) {
        expect(recipeInstructions(recipe, variant)).toContain('audioText');
      }
    }
  });

  it('keeps today\'s side as the default, so nothing changes unless the teacher picks', () => {
    expect(findRecipe('definitions')!.defaultVariant).toBe('findWord');
    expect(recipeInstructions(findRecipe('definitions')!)).toContain('text = the word.');
    expect(findRecipe('qa')!.defaultVariant).toBe('findCard');
  });

  it('never lets the voice say the answer on the "find its card" side', () => {
    for (const id of ['definitions', 'gapFill', 'collocations', 'translation'] as const) {
      const rules = recipeInstructions(findRecipe(id)!, 'findCard');
      expect(rules).toMatch(/never|audioText = ""/);
    }
  });
});
