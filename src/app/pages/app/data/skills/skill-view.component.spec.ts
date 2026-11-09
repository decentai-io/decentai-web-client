import { SkillViewComponent } from './skill-view.component';

describe('SkillViewComponent', () => {
  it('shows the skill itself, with its headings under the panel\'s own', () => {
    const component = new SkillViewComponent();
    component.skill = {
      id: 'sk_1', name: 'Writing', description: 'When writing.', text: '# Rules\n\nLead with the point.',
      owner: { groups: [], users: ['u1'] }, created_by: 'u1', handing: null, at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    };
    expect(component.body).toBe('### Rules\n\nLead with the point.');
    expect(component.written).not.toBe('');
  });
});
