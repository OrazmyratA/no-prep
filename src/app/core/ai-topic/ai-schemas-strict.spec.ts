import { AI_TOPIC_DRAFT_SCHEMA } from './ai-topic-draft';
import { LESSON_PLAN_SCHEMA } from './lesson-plan';
import { SPEAKING_ANALYSIS_SCHEMA } from './speaking-analysis';
import { SPEAKING_FEEDBACK_SCHEMA } from './speaking-feedback';
import { TASK_PREP_SCHEMA } from './task-prep';
import { WRITING_CHECK_SCHEMA } from './writing-check';

// ChatGPT's strict structured output refuses the whole request (400) unless every object says
// additionalProperties: false and lists all its properties as required.
function strictProblems(schema: any, path = 'root'): string[] {
  if (Array.isArray(schema)) return schema.flatMap((each, index) => strictProblems(each, `${path}[${index}]`));
  if (!schema || typeof schema !== 'object') return [];
  const problems: string[] = [];
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const keys = Object.keys(schema.properties ?? {}).sort();
    const required = [...(schema.required ?? [])].sort();
    if (JSON.stringify(keys) !== JSON.stringify(required)) problems.push(`${path}: every property must be required`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'object') problems.push(...strictProblems(value, `${path}.${key}`));
  }
  return problems;
}

describe('AI answer schemas', () => {
  const schemas: Record<string, unknown> = {
    topicDraft: AI_TOPIC_DRAFT_SCHEMA,
    lessonPlan: LESSON_PLAN_SCHEMA,
    speakingAnalysis: SPEAKING_ANALYSIS_SCHEMA,
    speakingFeedback: SPEAKING_FEEDBACK_SCHEMA,
    taskPrep: TASK_PREP_SCHEMA,
    writingCheck: WRITING_CHECK_SCHEMA
  };

  for (const [name, schema] of Object.entries(schemas)) {
    it(`${name} is accepted by ChatGPT's strict mode`, () => {
      expect(strictProblems(schema)).toEqual([]);
    });
  }
});
