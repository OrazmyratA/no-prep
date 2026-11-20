import { htmlTitle, toEmbedTarget, toLinkTarget, toPageUrl } from './presentation-links';

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

  it('opens any other https page as itself, and refuses everything else', () => {
    // Not Canva (only looks like it): an ordinary web page, never treated as a Canva design.
    expect(toPageUrl('https://canva.com.evil.io/design/abc/def')).toBe('https://canva.com.evil.io/design/abc/def');
    expect(toPageUrl('javascript:alert(1)')).toBeNull();
    expect(toPageUrl('http://example.com/lesson')).toBeNull();
  });
});

describe('toLinkTarget (Canva, Google Slides or any web page)', () => {
  it('keeps Canva and Google Slides on their embed views', () => {
    expect(toLinkTarget('https://www.canva.com/design/DAG1/key2/edit')?.source).toBe('canva');
    expect(toLinkTarget('https://docs.google.com/presentation/d/1AbC/edit')?.source).toBe('google');
  });

  it('takes any full https address as a web page', () => {
    expect(toLinkTarget('https://example.com/lessons/animals.html')).toEqual({
      embedUrl: 'https://example.com/lessons/animals.html',
      source: 'web'
    });
    expect(toLinkTarget('  https://wordwall.net/resource/123  ')?.source).toBe('web');
  });

  it('refuses http, scripts, files, bare words and text with spaces', () => {
    for (const pasted of [
      '', 'hello', 'example.com', 'http://example.com', 'javascript:alert(1)', 'file:///C:/x.html',
      'https://localhost/x', 'https://exa mple.com', 'data:text/html,<p>x</p>'
    ]) {
      expect(toLinkTarget(pasted)).toBeNull();
    }
  });
});

describe('htmlTitle', () => {
  it('reads the <title> of an HTML file', () => {
    expect(htmlTitle('<html><head><title> Animals &amp; Pets\n quiz </title></head></html>')).toBe('Animals & Pets quiz');
    expect(htmlTitle('<p>no title</p>')).toBe('');
  });
});
