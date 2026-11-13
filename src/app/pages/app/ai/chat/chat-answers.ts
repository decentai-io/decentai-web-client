// chat-answers.ts — a card the person answered, in a line of the thread.
//
// A card closes with what was decided (`card_closed`, round 3); read with
// what it asked (`card_opened`), it is a short entry on the person's side
// of the conversation: "You allowed Mail · Send draft", "You answered: Yes".
import { Card, CardClosed } from 'src/app/models/chat-protocol';

/** A closed card, as the thread shows it. */
export interface AnsweredCard {
  card_id: string;
  /** When it closed: where it stands in the conversation. */
  at: string;
  icon: 'check' | 'x' | 'clock';
  /** What was decided, in the person's words. */
  label: string;
  /** What was asked, where the label does not say it already. */
  asked: string;
}

/** Longer words are cut: the entry is a line, not the answer itself. */
const LONGEST = 80;

const cut = (text: string, most = LONGEST): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat;
};

/** "A, B and 2 more". */
const listed = (names: string[]): string =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;

/** A closed card, with the request it opened with where that is known. An
 *  older server's close carries no answer: it reads "Answered". */
export function answeredCard(closed: CardClosed & { at: string }, card?: Card): AnsweredCard {
  const entry = (icon: AnsweredCard['icon'], label: string, asked = ''): AnsweredCard =>
    ({ card_id: closed.card_id, at: closed.at, icon, label, asked: cut(asked, 140) });
  const answer = closed.answer;
  const kind = closed.kind ?? card?.kind;
  const request = card?.request as Record<string, any> | undefined;
  const asked = String(request?.['text'] || request?.['label'] || '');
  if (answer === null) return entry('clock', 'Expired', asked);
  if (answer === undefined) return entry('check', 'Answered', asked);
  const yes = (allowed: unknown, what: string) => entry(allowed === true ? 'check' : 'x',
    `You ${allowed === true ? 'allowed' : 'declined'} ${what}`);

  switch (kind) {
    case 'approval': {
      const items: { id: string; name?: string; function: string }[] = request?.['items'] ?? [];
      const decided = (answer['items'] ?? {}) as Record<string, boolean>;
      const allowed = (id: string) => ('allowed' in answer ? answer['allowed'] === true : decided[id] === true);
      const named = (some: typeof items) => listed(some.map((item) => item.name || item.function));
      if (!items.length) return yes('allowed' in answer ? answer['allowed'] : Object.values(decided).every(Boolean), 'it');
      const granted = items.filter((item) => allowed(item.id));
      if (granted.length === items.length) return yes(true, named(items));
      if (!granted.length) return yes(false, named(items));
      return entry('check', `You allowed ${named(granted)}; declined ${named(items.filter((item) => !allowed(item.id)))}`);
    }
    case 'network': {
      const hosts: string[] = request?.['hosts'] ?? [];
      return yes(answer['allowed'], `network access${hosts.length ? ` to ${listed(hosts)}` : ''}`);
    }
    case 'question':
      if (typeof answer['choice'] === 'string') return entry('check', `You answered: ${cut(answer['choice'])}`, asked);
      if (typeof answer['text'] === 'string') return entry('check', `You answered: ${cut(answer['text'])}`, asked);
      if (answer['file']) return entry('check', 'You sent a file', asked);
      return entry('x', 'You declined to answer', asked);
    case 'form': {
      const fields: { name: string; label?: string }[] = request?.['fields'] ?? [];
      const filled = Array.isArray(answer['filled']) ? (answer['filled'] as string[]) : [];
      const label = (name: string) => fields.find((field) => field.name === name)?.label || name;
      return entry('check', filled.length ? `You filled ${listed(filled.map(label))}` : 'You filled the form', asked);
    }
    case 'skill': {
      const name = String(request?.['skill']?.name || '');
      return entry(answer['save'] === true ? 'check' : 'x',
        `You ${answer['save'] === true ? 'saved' : 'declined'} the skill${name ? ` ${name}` : ''}`);
    }
    case 'memory':
      return answer['save'] === true ? entry('check', 'You saved it to memory', asked)
        : entry('x', 'You declined to save it to memory', asked);
    default:
      return entry('check', 'Answered', asked);
  }
}
