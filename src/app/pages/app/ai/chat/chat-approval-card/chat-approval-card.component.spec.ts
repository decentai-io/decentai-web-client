import { Card } from 'src/app/models/chat-protocol';
import { CardDecision, ChatApprovalCardComponent } from './chat-approval-card.component';

describe('ChatApprovalCardComponent', () => {
  function card(kind: Card['kind'], request: any): { component: ChatApprovalCardComponent; emitted: CardDecision[] } {
    const component = new ChatApprovalCardComponent();
    component.card = { card_id: 'd1', chat_id: 'c1', call: 'k1', agent: 'mail', status: 'open', at: '', kind, request } as Card;
    const emitted: CardDecision[] = [];
    component.decided.subscribe((decision) => emitted.push(decision));
    return { component, emitted };
  }

  it('lets an agent\'s call through, or not, remembered where the person says', () => {
    const { component, emitted } = card('approval', { function: 'send', call: 'record.read:logins', record: 'r1', level: 2 });
    expect(component.callLabel).toBe('read a record of logins');
    component.remember = true;
    component.allow(true);
    expect(emitted).toEqual([{ card_id: 'd1', answer: { allowed: true, remember: true } }]);
  });

  it('answers a network card with a yes or a no alone', () => {
    const { component, emitted } = card('network', { hosts: ['example.com'], purpose: 'Fetch a page' });
    component.allow(false);
    expect(emitted).toEqual([{ card_id: 'd1', answer: { allowed: false } }]);
  });

  it('answers a question as it expects: words, or one of its choices', () => {
    const words = card('question', { text: 'Which day?', expects: 'text' });
    words.component.answerWith('  Friday ');
    words.component.answerWith('   ');
    expect(words.emitted).toEqual([{ card_id: 'd1', answer: { text: 'Friday' } }]);

    const choice = card('question', { text: 'Which day?', expects: 'choice', choices: ['Mon', 'Fri'] });
    choice.component.answerWith('Fri');
    expect(choice.emitted).toEqual([{ card_id: 'd1', answer: { choice: 'Fri' } }]);

    // Declined, it is answered with nothing, which the agent hears as null.
    const declined = card('question', { text: 'Which day?', expects: 'file' });
    declined.component.decline();
    expect(declined.emitted).toEqual([{ card_id: 'd1', answer: {} }]);
  });

  it('asks a form\'s empty fields and a sign-in\'s unanswered questions, and sends the questions whole', () => {
    const { component, emitted } = card('form', {
      record: 'r1', resource: 'logins', label: 'Sign-ins', connect: false,
      fields: [{ name: 'password', label: 'Password', type: 'secret', required: true }],
      questions: { answers: { user: { type: 'text', value: 'ann' }, code: { type: 'secret', remember: false } } },
    });
    expect(component.asked.map((ask) => ask.key)).toEqual(['password', 'answers.code']);
    expect(component.formReady).toBeFalse();
    component.typed = { password: 'hunter22', 'answers.code': '1234' };
    component.submitForm();
    expect(emitted).toEqual([{ card_id: 'd1', connect: false, answer: { values: {
      password: 'hunter22',
      answers: { user: { type: 'text', remember: true, value: 'ann' }, code: { type: 'secret', remember: false, value: '1234' } },
    } } }]);
  });

  it('saves a skill or a memory only on the person\'s word, and answers nothing while on its way', () => {
    const { component, emitted } = card('skill', { skill: { name: 'Jira', description: 'Tickets', text: 'Run it.' } });
    expect(component.skillOpen).toBeTrue();
    component.save(false);
    component.busy = true;
    component.save(true);
    expect(emitted).toEqual([{ card_id: 'd1', answer: { save: false } }]);
  });
});
