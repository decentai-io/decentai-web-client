import { Card } from 'src/app/models/chat-protocol';
import { answeredCard } from './chat-answers';

describe('answeredCard', () => {
  const at = '2026-11-13T10:00:00Z';
  const base = { chat_id: 'c1', call: 'k1', agent: 'mail', status: 'answered' as const, at };
  const approval: Card = {
    ...base, card_id: 'd1', kind: 'approval',
    request: { items: [{ id: 'i1', agent: 'mail', function: 'draft_send', name: 'Mail · Send draft' },
      { id: 'i2', agent: 'mail', function: 'draft_delete' }] },
  };
  const question: Card = { ...base, card_id: 'd2', kind: 'question',
    request: { text: 'Which day suits you?', choices: ['Friday', 'Monday'], expects: 'choice' } };
  const label = (answer: Record<string, unknown> | null | undefined, card?: Card, kind?: Card['kind']) =>
    answeredCard({ card_id: card?.card_id ?? 'x', kind: kind ?? card?.kind, answer, at }, card).label;

  it('says what the person allowed or declined, by name', () => {
    expect(label({ items: { i1: true, i2: true } }, approval)).toBe('You allowed Mail · Send draft and draft_delete');
    expect(label({ items: { i1: false, i2: false } }, approval)).toBe('You declined Mail · Send draft and draft_delete');
    expect(label({ items: { i1: true, i2: false } }, approval)).toBe('You allowed Mail · Send draft; declined draft_delete');
    expect(label({ allowed: true }, undefined, 'approval')).toBe('You allowed it');
    const network: Card = { ...base, card_id: 'd3', kind: 'network', request: { hosts: ['example.com'], purpose: '' } };
    expect(label({ allowed: false }, network)).toBe('You declined network access to example.com');
  });

  it('says what was answered, with what was asked', () => {
    const entry = answeredCard({ card_id: 'd2', kind: 'question', answer: { choice: 'Friday' }, at }, question);
    expect([entry.icon, entry.label, entry.asked, entry.at]).toEqual(['check', 'You answered: Friday', 'Which day suits you?', at]);
    expect(label({ text: 'Any  day\nafter noon' }, question)).toBe('You answered: Any day after noon');
    expect(label({ file: 'r1' }, question)).toBe('You sent a file');
    expect(label({}, question)).toBe('You declined to answer');
    const form: Card = { ...base, card_id: 'd4', kind: 'form', request: { record: 'r', resource: 'login', label: 'Sign in',
      fields: [{ name: 'user', label: 'User name', type: 'text' }, { name: 'pass', type: 'secret' }], questions: {},
      connect: false } };
    expect(label({ filled: ['user', 'pass'] }, form)).toBe('You filled User name and pass');
    const memory: Card = { ...base, card_id: 'd5', kind: 'memory', request: { text: 'Likes tea' } };
    expect(label({ save: true }, memory)).toBe('You saved it to memory');
    const skill: Card = { ...base, card_id: 'd6', kind: 'skill', request: { skill: { name: 'Haiku', description: '', text: '' } } };
    expect(label({ save: false }, skill)).toBe('You declined the skill Haiku');
  });

  it('says a card expired, and only "Answered" where an older server kept no answer', () => {
    expect(answeredCard({ card_id: 'd2', answer: null, at }, question).icon).toBe('clock');
    expect(label(null, question)).toBe('Expired');
    expect(label(undefined, question)).toBe('Answered');
    expect(label(undefined)).toBe('Answered');
  });
});
