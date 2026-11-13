import { normalizeNode, NodesService } from './nodes.service';

describe('NodesService', () => {
  function create(answer: any = {}) {
    const sent: { endpoint: string; data: any }[] = [];
    const service = new NodesService({
      gateway: async (endpoint: string, data: any = {}) => {
        sent.push({ endpoint, data });
        return answer;
      },
    } as any);
    return { service, sent };
  }

  it('lists the tokens and the nodes they enrolled', async () => {
    const { service, sent } = create({ tokens: [{ _id: 'tok_a' }], nodes: [{ _id: 'runtime-1', token: 'tok_a' }] });

    const page = await service.tokens();

    expect(sent[0].endpoint).toBe('Nodes:Authority:list');
    expect(page.tokens.length).toBe(1);
    expect(page.enrolled.length).toBe(1);
  });

  it('asks for a page of runtimes, filtered, after a cursor, and reads the counts', async () => {
    const { service, sent } = create({
      nodes: [{ node_id: 'r1' }], next: 'r1', total: 30,
      counts: { total: 30, connected: 20, refused: 1, sandboxes: 9, draining: 2, chats: 5, shared: 4, own: 26 },
    });

    const page = await service.nodes({ q: 'gpu', state: 'connected', scope: 'own' }, 'r0', 20);

    expect(sent[0]).toEqual({
      endpoint: 'Nodes:Node:list', data: { limit: 20, after: 'r0', q: 'gpu', state: 'connected', scope: 'own' },
    });
    expect(page.next).toBe('r1');
    expect(page.total).toBe(30);
    expect(page.counts?.connected).toBe(20);
  });

  it('asks for the tokens that can enroll, and says the end', async () => {
    const { service, sent } = create({ tokens: [], nodes: [], next: null, total: 0, counts: { live: 0, spent: 3 } });

    const page = await service.tokens({ state: 'live' }, '', 10);

    expect(sent[0].data).toEqual({ limit: 10, state: 'live' });
    expect(page.next).toBeNull();
    expect(page.counts).toEqual({ live: 0, spent: 3 });
  });

  it('reads a refused list as empty, with the reason', async () => {
    const { service } = create({ error: 'Not allowed.' });

    const page = await service.nodes();

    expect(page.nodes).toEqual([]);
    expect(page.error).toBe('Not allowed.');
  });

  it('makes a token that enrolls for so many seconds, shared only when asked', async () => {
    const { service, sent } = create();

    await service.createToken({ kind: 'runtime', uses: 1, days: 7, labels: [], shared: false });
    await service.createToken({ kind: 'sandbox', uses: 2, days: 0.5, labels: ['gpu'], shared: true });

    expect(sent[0]).toEqual({
      endpoint: 'Nodes:Authority:create', data: { kind: 'runtime', expires: 604800, uses: 1, labels: [], shared: false },
    });
    expect(sent[1]).toEqual({
      endpoint: 'Nodes:Authority:create', data: { kind: 'sandbox', expires: 43200, uses: 2, labels: ['gpu'], shared: true },
    });
  });

  it('names the token, the runtime and the sandbox as the API server reads them', async () => {
    const { service, sent } = create();

    await service.revokeToken('tok_a');
    await service.updateNode('r1', { name: 'Big box', note: 'In the rack' });
    await service.refuse('r1', 'Stolen');
    await service.drain('r1', true);
    await service.drain('r1', false, 'sb1');

    expect(sent.map((one) => [one.endpoint, one.data])).toEqual([
      ['Nodes:Authority:revoke', { token_id: 'tok_a' }],
      ['Nodes:Node:update', { node_id: 'r1', name: 'Big box', note: 'In the rack' }],
      ['Nodes:Node:refuse', { node_id: 'r1', reason: 'Stolen' }],
      ['Nodes:Node:drain', { node_id: 'r1', drain: true }],
      ['Nodes:Node:drain', { node_id: 'r1', drain: false, sandbox_id: 'sb1' }],
    ]);
  });

  it('reads a report’s sandboxes: which drain, how many processes, and of which agents', () => {
    const node = normalizeNode({
      node_id: 'r1', scope: 'org_1', live: true, drained: ['sb2'],
      sandboxes: [
        { sandbox: 'sb1', machine: 'x86_64', room: { processes: 3, processes_max: 8, memory_used: 1, memory_max: 2 },
          processes: [{ agent: 'mail', org_id: 'org_1' }, { agent: 'mail', org_id: 'org_1' }] },
        { sandbox: 'sb2' },
      ],
    });

    expect(node.live).toBeTrue();
    expect(node.name).toBe('');
    expect(node.labels).toEqual([]);
    expect(node.sandboxes[0]).toEqual(jasmine.objectContaining({ sandbox_id: 'sb1', processes: 2, agents: ['mail'], draining: false }));
    expect(node.sandboxes[1]).toEqual(jasmine.objectContaining({ sandbox_id: 'sb2', processes: 0, agents: [], draining: true }));
  });
});
