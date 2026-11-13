import { fakeAsync, flush, tick } from '@angular/core/testing';

import { nextOf, pageAsk, readEvery, ServerList, ServerPage, ServerPages } from './paging';
import { SearchPicksComponent } from './search-picks.component';

/** A list the API server pages: 45 rows, `q` keeping those that hold
 *  it, `next` the last id of a page while more follow. */
function server(rows = Array.from({ length: 45 }, (_, i) => `r${String(i).padStart(2, '0')}`)) {
  const asked: { after: string; limit: number; q: string }[] = [];
  let q = '';
  const read = async (after: string, limit: number): Promise<ServerPage<string>> => {
    asked.push({ after, limit, q });
    const kept = rows.filter((row) => row.includes(q));
    const from = after ? kept.indexOf(after) + 1 : 0;
    const page = kept.slice(from, from + limit);
    return { rows: page, next: from + limit < kept.length ? page[page.length - 1] : null, total: kept.length };
  };
  return { read, asked, search: (text: string) => (q = text), rows };
}

describe('ServerPages', () => {
  it('reads each page after the cursor the one before gave, and goes back to one read', async () => {
    const list = server();
    const pages = new ServerPages(20, list.read);
    await pages.first();
    expect(pages.rows.length).toBe(20);
    expect(pages.total).toBe(45);
    expect(pages.hasNext).toBeTrue();

    await pages.go(2);
    await pages.go(3);
    expect(pages.page).toBe(3);
    expect(pages.rows).toEqual(['r40', 'r41', 'r42', 'r43', 'r44']);
    expect(pages.hasNext).toBeFalse();
    expect(list.asked.map((ask) => ask.after)).toEqual(['', 'r19', 'r39']);

    await pages.go(4);  // past the end: nothing asked
    await pages.go(1);
    expect(pages.rows[0]).toBe('r00');
    expect(list.asked.length).toBe(4);
    expect(list.asked[3].after).toBe('');
  });

  it('reads the page shown again, and the one before when it emptied', async () => {
    const list = server();
    const pages = new ServerPages(20, list.read);
    await pages.first();
    await pages.go(2);
    await pages.go(3);
    list.rows.splice(40);  // the last page's rows went
    await pages.reload();
    expect(pages.page).toBe(2);
    expect(pages.rows[0]).toBe('r20');
    expect(pages.total).toBe(40);
  });

  it('asks for a search once the typing stops, from the first page', fakeAsync(() => {
    const list = server();
    const pages = new ServerPages(20, list.read);
    void pages.first();
    flush();
    void pages.go(2);
    flush();

    list.search('r1');
    pages.search();
    pages.search();
    tick(100);
    expect(list.asked.length).toBe(2);
    tick(200);
    flush();
    expect(list.asked.length).toBe(3);
    expect(pages.page).toBe(1);
    expect(pages.total).toBe(10);
    expect(list.asked[2]).toEqual({ after: '', limit: 20, q: 'r1' });
  }));

  it('keeps what it shows when a read is refused, and drops an answer overtaken', async () => {
    let refuse = false;
    let hold: ((page: ServerPage<string>) => void) | null = null;
    const pages = new ServerPages<string>(2, (after) => {
      if (refuse) return Promise.resolve({ rows: [], next: null, total: 0, error: 'Not allowed.' });
      if (after === 'slow') return new Promise((resolve) => (hold = resolve));
      return Promise.resolve({ rows: ['a', 'b'], next: 'slow', total: 4 });
    });
    await pages.first();
    refuse = true;
    await pages.reload();
    expect(pages.rows).toEqual(['a', 'b']);
    expect(pages.error).toBe('Not allowed.');

    refuse = false;
    await pages.first();
    const slow = pages.go(2);
    const fresh = pages.go(1);
    await fresh;
    hold!({ rows: ['late'], next: null, total: 4 });
    await slow;
    expect(pages.rows).toEqual(['a', 'b']);
  });
});

describe('ServerList', () => {
  it('reads down a page at a time, and forgets rows gone', async () => {
    const list = server();
    const more = new ServerList(20, list.read);
    await more.first();
    await more.more();
    expect(more.rows.length).toBe(40);
    await more.more();
    expect(more.rows.length).toBe(45);
    expect(more.hasMore).toBeFalse();
    await more.more();
    expect(list.asked.length).toBe(3);

    more.drop((row) => row === 'r00' || row === 'r01');
    expect(more.rows.length).toBe(43);
    expect(more.total).toBe(43);

    await more.first();
    expect(more.rows.length).toBe(20);
  });
});

describe('paging asks', () => {
  it('sends the cursor and the filters that are set', () => {
    expect(pageAsk('', 20)).toEqual({ limit: 20 });
    expect(pageAsk('x9', 20, { q: '  ann ', state: 'all', chat_id: '', group_id: 'g1' }))
      .toEqual({ limit: 20, after: 'x9', q: 'ann', group_id: 'g1' });
    expect(nextOf({ next: 'r19' })).toBe('r19');
    expect(nextOf({ next: null })).toBeNull();
    expect(nextOf({})).toBeNull();
  });

  it('reads every page of a short list, and stops at a refusal', async () => {
    const list = server();
    const every = await readEvery(list.read, 20);
    expect(every.rows.length).toBe(45);
    expect(every.total).toBe(45);
    expect(list.asked.length).toBe(3);

    const refused = await readEvery(async () => ({ rows: [], next: null, total: 0, error: 'No.' }));
    expect(refused.error).toBe('No.');
  });
});

describe('SearchPicksComponent', () => {
  function picks() {
    const asked: { q: string; after: string }[] = [];
    const all = Array.from({ length: 30 }, (_, i) => ({ id: `g${i}`, name: `Group ${i}` }));
    const component = new SearchPicksComponent();
    component.legend = 'Groups';
    component.selected = new Set(['g25']);
    component.named = [{ id: 'g25', name: 'Group 25' }];
    component.search = async (q, after, limit) => {
      asked.push({ q, after });
      const kept = all.filter((pick) => pick.name.toLowerCase().includes(q.toLowerCase()));
      const from = after ? kept.findIndex((pick) => pick.id === after) + 1 : 0;
      const page = kept.slice(from, from + limit);
      return { rows: page, next: from + limit < kept.length ? page[page.length - 1].id : null, total: kept.length };
    };
    return { component, asked };
  }

  it('offers the first page, the chosen ones not on it first, and counts from the server', fakeAsync(() => {
    const { component, asked } = picks();
    component.ngOnInit();
    flush();
    expect(component.all).toBe(30);
    expect(component.rows.length).toBe(21);
    expect(component.rows[0].id).toBe('g25');

    void component.list.more();
    flush();
    expect(asked[1].after).toBe('g19');
    expect(component.rows.length).toBe(30);
  }));

  it('searches the server once the typing stops, and ticks in place', fakeAsync(() => {
    const { component, asked } = picks();
    const changed: string[] = [];
    component.changed.subscribe((id) => changed.push(id));
    component.ngOnInit();
    flush();

    component.query = 'group 2';
    component.list.search();
    tick(300);
    flush();
    expect(asked[asked.length - 1]).toEqual({ q: 'group 2', after: '' });
    expect(component.rows.map((pick) => pick.id))
      .toEqual(['g2', 'g20', 'g21', 'g22', 'g23', 'g24', 'g25', 'g26', 'g27', 'g28', 'g29']);
    expect(component.all).toBe(30);

    component.toggle('g2');
    component.toggle('g25');
    expect([...component.selected]).toEqual(['g2']);
    expect(changed).toEqual(['g2', 'g25']);
    component.ngOnDestroy();
  }));
});
