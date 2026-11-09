import { FilePreviewComponent, parseDelimited } from './file-preview.component';

describe('FilePreviewComponent', () => {
  function create(name: string, file: any = {}) {
    const component = new FilePreviewComponent({ fetchBlob: async () => new Blob() } as any);
    component.file = { record_id: 'x', kind: 'file', keys: {}, values: {}, file: { name, type: '', size: 0, ...file } } as any;
    return component;
  }

  it('reads a CSV whose fields hold commas, quotes and line breaks', () => {
    expect(parseDelimited('item,cost\n"Desk, oak",120\n"He said ""no""","two\nlines"\n', ','))
      .toEqual([['item', 'cost'], ['Desk, oak', '120'], ['He said "no"', 'two\nlines']]);
    expect(parseDelimited('a\tb\r\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not read a file too large to show, and says so', async () => {
    const component = create('big.csv', { size: 6 * 1024 * 1024 });
    component.ngOnChanges({ file: { previousValue: undefined } } as any);
    await Promise.resolve();

    expect(component.kind).toBe('table');
    expect(component.problem).toContain('Too large');
  });

  it('keeps a file\'s extension when it is renamed', () => {
    const component = create('notes.md');
    const renamed: string[] = [];
    component.rename.subscribe((name) => renamed.push(name));

    component.startRename();
    expect(component.draftName).toBe('notes');
    component.draftName = 'minutes';
    component.saveRename();

    expect(renamed).toEqual(['minutes.md']);
  });
});
