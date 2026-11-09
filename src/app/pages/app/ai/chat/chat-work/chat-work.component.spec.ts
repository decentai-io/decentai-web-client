import { WorkStep } from 'src/app/services/chat-state.service';
import { ChatWorkComponent } from './chat-work.component';

describe('ChatWorkComponent', () => {
  function card(steps: WorkStep[]): ChatWorkComponent {
    const component = new ChatWorkComponent();
    component.steps = steps;
    return component;
  }

  it('says what a finished turn came to, folded', () => {
    const component = card([
      { id: 'work:a', text: 'Saving the note', status: 'done' },
      { id: 'call:k1', text: 'Opened the notebook', agent: 'Notes' },
      { id: 'work:b', text: 'Sending the mail', status: 'failed' },
    ]);
    expect(component.running).toBeFalse();
    expect(component.headline).toBe('Ran 2 tasks · 1 failed');
    expect(component.open).toBeFalse();
  });

  it('says what runs while it works, open, until the person folds it', () => {
    const component = card([{ id: 'work:a', text: 'Saving the note', status: 'running' }]);
    component.elapsed = 12;
    expect(component.headline).toBe('Working · 1 running · 12s');
    expect(component.open).toBeTrue();
    component.toggleCard();
    expect(component.open).toBeFalse();
  });

  it('names an agent\'s line by its agent, and a note by its words alone', () => {
    const component = card([
      { id: 'call:k1', text: 'Opened the notebook', agent: 'Notes' },
      { id: 'note:1', text: 'Stopped.' },
    ]);
    expect(component.headline).toBe('Stopped.');
    expect(component.meta(component.steps[0])).toBe('Notes');
    expect(component.icon(component.steps[1])).toBe('circle-dot');
  });
});
