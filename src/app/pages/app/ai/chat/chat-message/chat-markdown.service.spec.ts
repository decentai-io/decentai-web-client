import { EngineService } from 'src/app/services/engine.service';
import { ChatMarkdownService } from './chat-markdown.service';

describe('ChatMarkdownService', () => {
  const clean = (html: string) => ChatMarkdownService.withoutRemoteMedia(html);
  const FILE = ChatMarkdownService.FILE;
  let address: string;

  beforeEach(() => {
    address = EngineService.address;
    EngineService.address = 'https://engine.example/decentai';
  });

  afterEach(() => {
    EngineService.address = address;
  });

  it('keeps words in angle brackets that name no element as text', () => {
    const kept = ChatMarkdownService.wordsKept;

    expect(kept('<p>Review overtime on <date>.</p>')).toBe('<p>Review overtime on &lt;date&gt;.</p>');
    expect(kept('<p>Hi <my-name/> and </name></p>')).toBe('<p>Hi &lt;my-name/&gt; and &lt;/name&gt;</p>');
    expect(kept('<p>one<br>two <b>bold</b></p>')).toBe('<p>one<br>two <b>bold</b></p>');
    expect(kept('<pre><code>&lt;date&gt;</code></pre>')).toBe('<pre><code>&lt;date&gt;</code></pre>');
  });

  it('turns a picture from elsewhere into a link, and loads nothing', () => {
    const html = clean('<p>See <img src="https://elsewhere.example/p.png?q=secret" alt="the chart"></p>');

    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://elsewhere.example/p.png?q=secret">the chart</a>');
  });

  it('shows the address when the picture has no description', () => {
    const html = clean('<img src="https://elsewhere.example/p.png">');

    expect(html).toBe('<a href="https://elsewhere.example/p.png">https://elsewhere.example/p.png</a>');
  });

  it('marks an engine file to be fetched with the session, and asks for nothing yet', () => {
    const html = clean('<img src="https://engine.example/decentai/download/fil_1" alt="mine">');

    expect(html).toContain(`${FILE}="fil_1"`);
    expect(html).not.toContain('src=');
  });

  it('reads the old one-origin address as the engine file it named', () => {
    const html = clean('<img src="/download/fil%202" alt="old">');

    expect(html).toContain(`${FILE}="fil 2"`);
    expect(html).not.toContain('src=');
  });

  it('keeps a picture written out as data', () => {
    expect(clean('<img src="data:image/png;base64,AAAA" alt="inline">')).toContain('src="data:image/png');
  });

  it('shows nothing else of the engine or this page inline', () => {
    for (const elsewhere of [
      'https://engine.example/decentai/status',
      'https://engine.example/other/download/fil_1',
      'https://engine.example/decentai/download/fil_1/more',
      `${window.location.origin}/assets/brand/logo.png`,
      'https://user:pass@engine.example/decentai/download/fil_1',
    ]) {
      const html = clean(`<img src="${elsewhere}" alt="x">`);
      expect(html).withContext(elsewhere).not.toContain('<img');
      expect(html).withContext(elsewhere).not.toContain(FILE);
    }
  });

  it('marks a link to an engine file, so following it carries the session', () => {
    const html = clean('<p><a href="https://engine.example/decentai/download/fil_3">report.pdf</a></p>');

    expect(html).toContain(`${FILE}="fil_3"`);
    expect(clean('<a href="https://elsewhere.example/x">x</a>')).not.toContain(FILE);
  });

  it('makes a video or a sound a link, never a player', () => {
    const html = clean('<video src="https://engine.example/decentai/download/fil_4"></video>'
      + '<audio><source src="https://elsewhere.example/a.mp3"></audio>');

    expect(html).not.toContain('<video');
    expect(html).not.toContain('<audio');
    expect(html).toContain(`${FILE}="fil_4"`);
    expect(html).toContain('href="https://elsewhere.example/a.mp3"');
  });

  it('drops the other ways a picture can be named elsewhere', () => {
    const html = clean(
      '<img src="data:image/png;base64,AAAA" srcset="https://elsewhere.example/b.png 2x">'
      + '<picture><source srcset="https://elsewhere.example/c.png"><img src="https://elsewhere.example/d.png" alt="d"></picture>'
      + '<video poster="https://elsewhere.example/e.png"></video>');

    expect(html).not.toContain('srcset');
    expect(html).not.toContain('<source');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('d.png"><');
  });

  it('leaves words alone', () => {
    const html = '<p>Nothing to <strong>load</strong> here.</p>';

    expect(clean(html)).toBe(html);
  });
});
