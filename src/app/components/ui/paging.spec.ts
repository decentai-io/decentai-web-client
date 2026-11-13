import { MoreComponent } from './more.component';
import { Paging, Shown } from './paging';
import { PillsComponent } from './pills.component';

describe('Paging', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);

  it('cuts the rows of the page shown', () => {
    const paging = new Paging(20);
    expect(paging.of(rows)).toEqual(rows.slice(0, 20));
    paging.page = 3;
    expect(paging.of(rows)).toEqual([40, 41, 42, 43, 44]);
    expect(paging.more(rows)).toBeTrue();
    expect(paging.more(rows.slice(0, 20))).toBeFalse();
  });

  it('goes back to the first page when the search changes, and stays while it does not', () => {
    const paging = new Paging(20);
    paging.of(rows, '');
    paging.page = 2;
    expect(paging.of(rows, '')[0]).toBe(20);
    expect(paging.of(rows, 'a')[0]).toBe(0);
    expect(paging.page).toBe(1);
  });

  it('shows the last page when rows went from under it', () => {
    const paging = new Paging(20);
    paging.page = 3;
    expect(paging.of(rows.slice(0, 25))).toEqual(rows.slice(20, 25));
    expect(paging.page).toBe(2);
    expect(paging.of([])).toEqual([]);
    expect(paging.page).toBe(1);
  });
});

describe('Shown', () => {
  it('shows a step at a time, and goes back to the first step', () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const shown = new Shown(10);
    expect(shown.of(rows).length).toBe(10);
    expect(shown.count(rows)).toBe(10);
    shown.more();
    shown.more();
    expect(shown.of(rows).length).toBe(25);
    expect(shown.count(rows)).toBe(25);
    shown.reset();
    expect(shown.count(rows)).toBe(10);
    expect(shown.of([1, 2])).toEqual([1, 2]);
  });
});

describe('MoreComponent', () => {
  it('offers more while some are not shown, or while the server has more', () => {
    const more = new MoreComponent();
    Object.assign(more, { shown: 10, total: 25 });
    expect(more.visible).toBeTrue();
    more.shown = 25;
    expect(more.visible).toBeFalse();

    const older = new MoreComponent();
    Object.assign(older, { shown: 25, hasMore: true });
    expect(older.visible).toBeTrue();
    older.hasMore = false;
    expect(older.visible).toBeFalse();
  });
});

describe('PillsComponent', () => {
  it('shows the first few and counts the rest, never "+1 more"', () => {
    const pills = new PillsComponent();
    pills.items = ['a', 'b', 'c', 'd'];
    expect(pills.first).toEqual(['a', 'b', 'c', 'd']);
    expect(pills.rest).toEqual([]);
    pills.items = ['a', 'b', 'c', 'd', 'e'];
    expect(pills.first).toEqual(['a', 'b', 'c']);
    expect(pills.rest).toEqual(['d', 'e']);
  });
});
