import { describe, expect, it } from 'vitest';
import { CHECK_CHIPS, chipTone, examHasChips } from './speaking-check-chips';
import { CHECK_EXAM_LIST, CHECK_EXAMS, maxTotal } from './speaking-check-exams';
import { cambridgeGrade, cambridgeScale, examResult, ieltsBand, markFromChips, passed, schoolResult } from './speaking-check-scoring';

const { ket, pet, fce, cae, flyers, ielts } = CHECK_EXAMS;

describe('official totals (Cambridge practice-test guide, Nov 2023)', () => {
  it('adds up the weighted criteria to each exam\'s maximum', () => {
    expect(maxTotal(ket)).toBe(45);
    expect(maxTotal(pet)).toBe(30);
    expect(maxTotal(fce)).toBe(60);
    expect(maxTotal(cae)).toBe(75);
    expect(maxTotal(flyers)).toBe(15);
  });

  it('weights A2 Key: G&V, Pron, IC ×2 and Global Achievement ×3', () => {
    // A row of the owner's A2 Key sheet: 5, 4, 3, 4 → 36.
    expect(examResult(ket, { grammarVocab: 5, pronunciation: 4, interactiveCommunication: 3, global: 4 }).total).toBe(36);
    expect(examResult(ket, { grammarVocab: 5, pronunciation: 4, interactiveCommunication: 5, global: 5 }).total).toBe(43);
  });
});

describe('Cambridge English Scale', () => {
  it('gives exactly the published points', () => {
    expect([10, 18, 27, 41].map((raw) => cambridgeScale(ket, raw))).toEqual([82, 100, 120, 140]);
    expect([7, 12, 18, 27].map((raw) => cambridgeScale(pet, raw))).toEqual([102, 120, 140, 160]);
    expect([14, 24, 36, 54].map((raw) => cambridgeScale(fce, raw))).toEqual([122, 140, 160, 180]);
    expect([17, 30, 45, 66].map((raw) => cambridgeScale(cae, raw))).toEqual([142, 160, 180, 200]);
  });

  it('runs on the straight line between points, up to the top of the scale', () => {
    expect(cambridgeScale(ket, 45)).toBe(150);
    expect(cambridgeScale(pet, 30)).toBe(170);
    expect(cambridgeScale(ket, 34)).toBe(130);   // owner's sheet: 130
    expect(cambridgeScale(ket, 43)).toBe(145);   // owner's sheet: 145
    expect(cambridgeScale(ket, 9)).toBeNull();   // below the lowest reported score
  });

  it('reads the grade and CEFR level from the results page bands', () => {
    expect(cambridgeGrade(ket, 145)).toMatchObject({ grade: 'A', cefr: 'B1' });
    expect(cambridgeGrade(ket, 133)).toMatchObject({ grade: 'B', cefr: 'A2' });
    expect(cambridgeGrade(ket, 132)).toMatchObject({ grade: 'C', cefr: 'A2' });
    expect(cambridgeGrade(ket, 119)).toMatchObject({ grade: 'Level A1', cefr: 'A1' });
    expect(cambridgeGrade(pet, 152)).toMatchObject({ grade: 'C', cefr: 'B1' });
    expect(cambridgeGrade(ket, 90)).toBeNull();
  });
});

describe('chips → marks', () => {
  const criterion = ket.criteria[0];
  const flyersPron = flyers.criteria[1];

  it('averages the bands of the tapped chips (5 and 3 → 4, 3 and 1 → 2)', () => {
    expect(markFromChips([{ band: 5 }, { band: 3 }], criterion, true)).toBe(4);
    expect(markFromChips([{ band: 3 }, { band: 1 }], criterion, true)).toBe(2);
    expect(markFromChips([], criterion, true)).toBeNull();
  });

  it('rounds to half marks for the main suite, whole marks for young learners', () => {
    expect(markFromChips([{ band: 5 }, { band: 5 }, { band: 3 }], criterion, true)).toBe(4.5);
    expect(markFromChips([{ band: 5 }, { band: 5 }, { band: 3 }], flyersPron, false)).toBe(4);
  });

  it('applies the young learners\' pronunciation ceiling of 3', () => {
    expect(markFromChips([{ band: 5 }, { band: 5 }, { band: 3, cap: 3 }], flyersPron, false)).toBe(3);
  });
});

describe('IELTS band', () => {
  it('averages the four criteria to the nearest half band', () => {
    expect(ieltsBand([6, 6, 7, 7])).toBe(6.5);
    expect(ieltsBand([6, 6, 6, 7])).toBe(6.5);   // 6.25 → 6.5
    expect(ieltsBand([7, 7, 7, 6])).toBe(7);     // 6.75 → 7
    expect(ieltsBand([6, 6, 6, 6])).toBe(6);
    expect(examResult(ielts, { fluency: 6, lexical: 6, grammar: 5, pronunciation: 6 }).total).toBe(6);  // 5.75 → 6
  });
});

describe('school scale (the PMP sheet: four criteria × 5 = 20 points)', () => {
  const pmp = { id: 'pmp', name: 'PMP speaking 20 pts', basedOn: 'ket' as const, pointsPerCriterion: 5, passMark: { value: 60, unit: 'percent' as const } };

  it('adds the marks on the school\'s own points, without Cambridge weighting', () => {
    const result = schoolResult(ket, pmp, { grammarVocab: 4, pronunciation: 4, interactiveCommunication: 4, global: 5 });
    expect(result).toEqual({ complete: true, total: 17, max: 20, passed: true });
    expect(schoolResult(ket, pmp, { grammarVocab: 2, pronunciation: 3, interactiveCommunication: 3, global: 3 }).passed).toBe(false);
  });

  it('checks a pass mark in points or percent', () => {
    expect(passed(12, 20, { value: 60, unit: 'percent' })).toBe(true);
    expect(passed(11.5, 20, { value: 12, unit: 'points' })).toBe(false);
    expect(passed(11.5, 20, null)).toBeNull();
  });
});

describe('ready-made chips', () => {
  it('cover every criterion of each exam that offers chips, within its scale, with unique ids', () => {
    const ids = new Set<string>();
    for (const exam of CHECK_EXAM_LIST.filter((item) => examHasChips(item.id))) {
      for (const criterion of exam.criteria) {
        const list = CHECK_CHIPS[exam.id]![criterion.id];
        expect(list?.length, `${exam.id}.${criterion.id}`).toBeGreaterThan(0);
        for (const chip of list!) {
          expect(chip.band).toBeGreaterThanOrEqual(0);
          expect(chip.band).toBeLessThanOrEqual(criterion.max);
          expect(ids.has(chip.id), chip.id).toBe(false);
          ids.add(chip.id);
        }
      }
    }
    expect(ids.size).toBeGreaterThan(100);
  });

  it('offers chips for the exams the owner named, not yet B2 First / C1 Advanced', () => {
    expect(['starters', 'movers', 'flyers', 'ket', 'pet', 'ielts'].every((id) => examHasChips(id as never))).toBe(true);
    expect(examHasChips('fce')).toBe(false);
    expect(examHasChips('cae')).toBe(false);
  });

  it('tells strengths from weaknesses by band', () => {
    expect(chipTone({ id: 'x', text: '', band: 5 }, 5)).toBe('strength');
    expect(chipTone({ id: 'x', text: '', band: 3 }, 5)).toBe('ok');
    expect(chipTone({ id: 'x', text: '', band: 1 }, 5)).toBe('weakness');
    expect(chipTone({ id: 'x', text: '', band: 7 }, 9)).toBe('strength');
  });
});
