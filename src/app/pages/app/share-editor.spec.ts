import { ShareEditor } from './share-editor';

describe('ShareEditor', () => {
  const ME = 'usr_me';
  const editor = new ShareEditor(() => ME);
  editor.peers = {
    people: [
      { user_id: ME, name: 'Me', email: 'me@x' }, { user_id: 'u1', name: 'Dana', email: 'd@x' },
      { user_id: 'u2', name: 'Sam', email: 's@x' }, { user_id: 'u3', name: 'Lee', email: 'l@x' },
    ],
    groups: [{ group_id: 'g1', name: 'Design' }, { group_id: 'g2', name: 'Ops' }],
    everyone: 'g0',
    mine: ['g1'],
  };

  it('says who sees a thing of mine, by name', () => {
    expect(editor.chip({ groups: [], users: [ME] }, ME).word).toBe('Private');
    expect(editor.chip({ groups: ['g0'], users: [ME] }, ME).word).toBe('Everyone');
    expect(editor.chip({ groups: ['g1', 'g2'], users: [ME] }, ME)).toEqual({ word: 'Design, Ops', names: 'Design, Ops' });
    expect(editor.chip({ groups: [], users: [ME, 'u1', 'u2', 'u3'] }, ME))
      .toEqual({ word: 'Dana and 2 others', names: 'Dana, Sam, Lee' });
  });

  it('says whose somebody else\'s thing is, which is what the reader does not know', () => {
    expect(editor.chip({ groups: ['g1'], users: ['u1'] }, 'u1')).toEqual({ word: 'Shared by Dana', names: 'With Design' });
    expect(editor.chip({ groups: ['g0'], users: ['u9'] }, 'u9').word).toBe('Shared by a colleague');
  });

  it('names a group or a person that is gone as gone, not as nothing', () => {
    expect(editor.chip({ groups: ['g9'], users: [ME] }, ME).word).toBe('a deleted group');
    expect(editor.chip({ groups: [], users: [ME, 'u9'] }, ME).word).toBe('someone who left');
  });

  it('shares with the whole organization through its Everyone group, and only into my groups', () => {
    editor.open('r1', { groups: ['g0'], users: [ME] });
    expect(editor.mode).toBe('org');
    expect(editor.owner()).toEqual({ groups: ['g0'], users: [ME] });
    expect(editor.myGroups.map((group) => group.group_id)).toEqual(['g1']);
    editor.mode = 'people';
    editor.toggleUser('u1');
    expect(editor.owner()).toEqual({ groups: [], users: [ME, 'u1'] });
  });
});
