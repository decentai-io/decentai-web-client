import { InstallReviewComponent } from './install-review.component';

describe('InstallReviewComponent', () => {
  function manifest(overrides: any = {}) {
    return {
      schema: 3,
      agent: { id: 'mail', name: 'Mail', version: '2.0.0' },
      functions: [
        { id: 'read', name: 'Read', level: 0, calls: ['record.read:mailbox'] },
        { id: 'send', name: 'Send', level: 3 },
      ],
      resources: { secrets: [{ id: 'mailbox', label: 'Mailbox' }], data: [{ id: 'rules' }] },
      network: { hosts: ['imap.example.com', { from_secret: 'mailbox.server' }] },
      ...overrides,
    };
  }

  function create(offer: any = {}, approved: any = null) {
    const component = new InstallReviewComponent();
    component.source = { url: 'https://agents.example.com/catalog.json' } as any;
    component.offer = {
      source_id: 's1', digest: 'sha256:x', status: 'not_installed', machines: ['x86_64', 'riscv'], base: 'python-3.12',
      readme: '', errors: [], manifest: manifest(), ...offer,
    } as any;
    component.approved = approved;
    return component;
  }

  it('reads a manifest as the facts installing agrees to, counted by level', () => {
    const component = create();
    expect(component.tally).toEqual([{ name: 'Reads', count: 1 }, { name: 'Outside action', count: 1 }]);
    expect(component.resources.map((group) => [group.word, component.kindsOf(group)]))
      .toEqual([['Secrets', 'Mailbox'], ['Records', 'rules']]);
    expect(component.network.hosts).toEqual(['imap.example.com']);
    expect(component.network.from_secrets).toEqual(['mailbox.server']);
  });

  it('names the machines it runs on as a person reads them', () => {
    expect(create().machines).toEqual(['Intel or AMD (x86-64)', 'riscv']);
  });

  it('puts a README\'s headings under the page\'s own, and folds only a long one', () => {
    const component = create({ readme: '# Mail\n```\n# not a heading\n```' });
    expect(component.readme).toBe('### Mail\n```\n# not a heading\n```');
    expect(component.readmeLong).toBeFalse();
    expect(create({ readme: 'x'.repeat(1000) }).readmeLong).toBeTrue();
  });

  it('has nothing to say about changes on a first install', () => {
    expect(create().changes).toEqual([]);
  });

  it('describes an update as what changes, not as a version number', () => {
    const before = manifest({
      functions: [{ id: 'read', name: 'Read', level: 0 }, { id: 'old', name: 'Old', level: 1 }],
      resources: { secrets: [{ id: 'mailbox', label: 'Mailbox' }] },
      network: { hosts: ['imap.example.com'] },
    });
    expect(create({}, before).changes).toEqual([
      'read may now call record.read:mailbox',
      'New function: send (Outside action)',
      'Function removed: old',
      'New host, read from a secret: mailbox.server',
      'Now keeps records: rules',
    ]);
  });
});
