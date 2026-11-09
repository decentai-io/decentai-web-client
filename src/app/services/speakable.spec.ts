import { speakable } from './speakable';

describe('speakable, an answer as a voice says it', () => {
  it('reads a table row by row, each value with its column', () => {
    const said = speakable([
      'The team:',
      '',
      '| Name | Role |',
      '|------|:----:|',
      '| **Ada** | Engineer |',
      '| Grace | Admiral |',
    ].join('\n'));

    expect(said).toContain('A table of 2 rows, with the columns Name and Role.');
    expect(said).toContain('Row 1: Name, Ada; Role, Engineer.');
    expect(said).toContain('Row 2: Name, Grace; Role, Admiral.');
    expect(said).not.toContain('|');
    expect(said).not.toContain('---');
  });

  it('knows a table by its divider, however short, and a rule from one', () => {
    expect(speakable('| A | B |\n|---|:-:|\n| 1 | 2 |')).toContain('Row 1: A, 1; B, 2.');
    expect(speakable('Above\n\n---\n\nBelow')).toBe('Above\nBelow');
  });

  it('says how many rows are left past the first twelve', () => {
    const rows = Array.from({ length: 15 }, (_, i) => `| ${i} | x |`);
    const said = speakable(['| N | V |', '|---|---|', ...rows].join('\n'));
    expect(said).toContain('Row 12:');
    expect(said).not.toContain('Row 13:');
    expect(said).toContain('And 3 more rows.');
  });

  it('reads links as their words and leaves code out', () => {
    const said = speakable('See [the guide](https://decentai.io/support) or https://x.test/a.\n```js\nlet a = 1;\n```\nRun `npm ci` first.');
    expect(said).toContain('See the guide or a link');
    expect(said).not.toContain('let a');
    expect(said).toContain('Run npm ci first.');
  });

  it('ends headings and list items as sentences', () => {
    const said = speakable('## Next steps\n- Save the note\n- Send it');
    expect(said.split('\n')).toEqual(['Next steps.', 'Save the note.', 'Send it.']);
  });
});
