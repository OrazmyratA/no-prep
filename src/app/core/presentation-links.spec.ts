import { toEmbedTarget, toPageUrl } from './presentation-links';

describe('toEmbedTarget (Canva / Google Slides links)', () => {
  it('turns every kind of Canva link into its embed view', () => {
    const embed = 'https://www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/view?embed';
    for (const pasted of [
      'https://www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/view?utm_content=x&utm_medium=link',
      'https://www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/edit',
      'https://www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/watch',
      'www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/view?embed',
      '<div><iframe loading="lazy" src="https://www.canva.com/design/DAGhbGUMnnI/gZyl0pFu9hrdUYmKXUictg/view?embed" allowfullscreen></iframe></div>'
    ]) {
      expect(toEmbedTarget(pasted)).toEqual({ embedUrl: embed, source: 'canva' });
    }
  });

  it('keeps a Canva link without its key', () => {
    expect(toEmbedTarget('https://www.canva.com/design/DAGhbGUMnnI/edit')?.embedUrl)
      .toBe('https://www.canva.com/design/DAGhbGUMnnI/view?embed');
  });

  it('turns Google Slides links (shared or published) into their embed view', () => {
    expect(toEmbedTarget('https://docs.google.com/presentation/d/1AbC_d-9/edit#slide=id.p')).toEqual({
      embedUrl: 'https://docs.google.com/presentation/d/1AbC_d-9/embed?start=false&loop=false',
      source: 'google'
    });
    expect(toEmbedTarget('https://docs.google.com/presentation/d/e/2PACX-1vQ/pub?start=false')?.embedUrl)
      .toBe('https://docs.google.com/presentation/d/e/2PACX-1vQ/embed?start=false&loop=false');
  });

  it('refuses anything else', () => {
    for (const pasted of [
      '',
      'hello',
      'https://example.com/design/abc',
      'https://evilcanva.com/design/abc/def',
      'https://canva.com.evil.io/design/abc/def',
      'https://www.canva.com/templates/abc',
      'javascript:alert(1)',
      'https://docs.google.com/document/d/abc/edit'
    ]) {
      expect(toEmbedTarget(pasted)).toBeNull();
    }
  });
});

describe('toPageUrl (open the presentation on its own site)', () => {
  it('keeps a plain link as the teacher pasted it, without the embed switch', () => {
    expect(toPageUrl('https://www.canva.com/design/DAG1/key2/edit?utm_source=share'))
      .toBe('https://www.canva.com/design/DAG1/key2/edit?utm_source=share');
    expect(toPageUrl('https://www.canva.com/design/DAG1/key2/view?embed'))
      .toBe('https://www.canva.com/design/DAG1/key2/view');
  });

  it('turns embed code back into the design page', () => {
    expect(toPageUrl('<iframe src="https://www.canva.com/design/DAG1/key2/view?embed" allowfullscreen></iframe>'))
      .toBe('https://www.canva.com/design/DAG1/key2/view');
    expect(toPageUrl('<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vQ/embed?start=false"></iframe>'))
      .toBe('https://docs.google.com/presentation/d/e/2PACX-1vQ/pub');
    expect(toPageUrl('docs.google.com/presentation/d/1AbC/edit')).toBe('https://docs.google.com/presentation/d/1AbC/edit');
  });

  it('refuses links that are not Canva or Google Slides', () => {
    expect(toPageUrl('https://canva.com.evil.io/design/abc/def')).toBeNull();
    expect(toPageUrl('javascript:alert(1)')).toBeNull();
  });
});
