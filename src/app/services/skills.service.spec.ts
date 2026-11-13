import { RequestService } from './request.service';
import { readShared, SHARED_PAGE } from './skills.service';

describe('readShared', () => {
  const item = (id: number) => ({ id: `s${String(id).padStart(4, '0')}`, owner: { users: [], groups: [] }, created_by: 'u', handing: null });

  it('reads every page, after the last id, until a page is short', async () => {
    const all = Array.from({ length: SHARED_PAGE * 2 + 5 }, (_, i) => item(i));
    const asked: any[] = [];
    const request = {
      gateway: async (endpoint: string, data: any) => {
        asked.push({ endpoint, ...data });
        const start = data.after ? all.findIndex((one) => one.id === data.after) + 1 : 0;
        return { items: all.slice(start, start + data.limit), handed: [item(9999)] };
      },
    } as unknown as RequestService;

    const found = await readShared(request, 'Skills:Skill:list');

    expect(found.items.length).toBe(all.length);
    expect(found.handed.length).toBe(1);
    expect(asked.map((call) => call.after ?? '')).toEqual(['', all[SHARED_PAGE - 1].id, all[SHARED_PAGE * 2 - 1].id]);
    expect(asked.every((call) => call.endpoint === 'Skills:Skill:list' && call.limit === SHARED_PAGE)).toBeTrue();
  });

  it('stops at a refusal with what it read', async () => {
    const request = { gateway: async () => ({ error: 'No.' }) } as unknown as RequestService;
    const found = await readShared(request, 'Mcp:Server:list');
    expect(found).toEqual({ items: [], handed: [], error: 'No.' });
  });
});
