import { AgentResource, InstalledAgent, Manifest } from 'src/app/services/agents.service';

/** Permission levels 0 to 3, in the words every page uses: chips,
 *  functions, the review, a card in a chat. How much of an agent runs
 *  without asking is what a chat's trust decides, and "3" does not
 *  say it. The number is a tooltip, never the name. */
export const PERMISSION_LEVELS = ['Reads', 'Changes', 'Wider change', 'Outside action'];

export function levelLabel(level: number | null | undefined): string {
  return level === null || level === undefined
    ? '' : PERMISSION_LEVELS[level] || `Level ${level}`;
}

/** What each level means, by its word. Whether a function asks first
 *  is not the level's to say alone: it asks when its level is above
 *  the trust level of the chat that calls it. */
export const LEVEL_MEANINGS: Record<string, string> = {
  'Reads': 'Level 0. Reads only, and changes nothing. Runs in every chat without asking.',
  'Changes': 'Level 1. An ordinary change inside the platform. Asks first in a chat whose trust level is 0.',
  'Wider change': 'Level 2. A change with wider reach, still inside the platform. Asks first in a chat whose trust level is below 2.',
  'Outside action': 'Level 3. Acts outside the platform. Asks first in every chat whose trust level is below 3.',
};

/** How many functions of a manifest sit at each level, in the order of
 *  the levels: how much of it runs unattended, counted. */
export function levelTally(manifest: Manifest | null | undefined): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const fn of manifest?.functions || []) {
    const name = levelLabel(fn.level);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return PERMISSION_LEVELS.filter((name) => counts.has(name)).map((name) => ({ name, count: counts.get(name)! }));
}

/** Where an installed agent stands: one word, and the colour it
 *  deserves (styles/controls.scss; '' is the plain chip). */
export interface Standing {
  kind: 'failed' | 'checking' | 'update' | 'ready';
  word: string;
  tone: '' | 'danger' | 'live' | 'accent';
}

/** The standing of an installed agent, for the list, its own page and
 *  the counts alike, so they cannot disagree. The first that holds: a
 *  runtime's check failed, the check is under way, its source offers a
 *  newer version, or it is ready. */
export function standingOf(agent: InstalledAgent, updateWaiting = false): Standing {
  if (agent.state === 'failed') return { kind: 'failed', word: 'Failed', tone: 'danger' };
  if (agent.state === 'checking') return { kind: 'checking', word: 'Checking', tone: 'live' };
  if (updateWaiting) return { kind: 'update', word: 'Update available', tone: '' };
  return { kind: 'ready', word: 'Ready', tone: 'accent' };
}

/** Where an agent connects, as its manifest declared it (agents.md §8). */
export interface AgentNetwork {
  /** It declared `any`: any public address, on any port. */
  any: boolean;
  /** Names; a leading `*.` is every host under one, and `:<port>` the
   *  only port it is reached on. */
  hosts: string[];
  /** `<secret>.<field>`: the host written in that field of a secret,
   *  once the secret is handed to it. */
  from_secrets: string[];
  /** A function may ask to open other hosts for one call
   *  (`network.open`), which a person is shown first. */
  opens: boolean;
}

/** A manifest's `network`, read the way the platform reads it. */
export function networkOf(manifest: Manifest | null | undefined): AgentNetwork {
  const hosts = manifest?.network?.hosts || [];
  return {
    any: hosts.includes('any'),
    hosts: hosts.filter((host): host is string => typeof host === 'string' && host !== 'any'),
    from_secrets: hosts.filter((host): host is { from_secret: string } => typeof host === 'object' && !!host)
      .map((host) => String(host.from_secret || '')),
    opens: (manifest?.functions || []).some((fn) => (fn.calls || []).includes('network.open')),
  };
}

/** A host read from a secret, in words. */
export function credentialHost(field: string): string {
  return `the address in ${field}`;
}

/** What is said under the hosts: the one sentence that tells a reader
 *  how much the list means. */
export function networkNote(network: AgentNetwork): string {
  if (network.any) {
    return 'It declared that its work is the open web. Addresses inside your own network stay refused.';
  }
  const own = network.hosts.length || network.from_secrets.length;
  if (network.opens) {
    return `${own ? 'Beyond the hosts it declared, it' : 'By itself it connects to nothing. It'} may ask to `
      + 'open others for one call: a card shows you the code, its purpose and the hosts first, and only '
      + 'what you allow is opened, for that call.';
  }
  if (!own) return 'It declared that it connects to nothing outside the platform.';
  return network.from_secrets.length
    ? 'A host read from a secret is whatever address that secret holds.'
    : 'These are the only hosts it declared.';
}

/** The line of a card that a person compares agents by: how many
 *  functions, the secrets it asks for, and where it connects (the first
 *  host, and how many more). */
export function agentFacts(manifest: Manifest | null | undefined): string[] {
  const functions = manifest?.functions?.length || 0;
  const secrets = manifest?.resources?.secrets?.length || 0;
  const network = networkOf(manifest);
  const facts = [`${functions} ${functions === 1 ? 'function' : 'functions'}`];
  if (secrets) facts.push(`${secrets} ${secrets === 1 ? 'secret' : 'secrets'}`);
  if (network.any) {
    facts.push('the open web');
  } else if (network.hosts.length) {
    const more = network.hosts.length - 1;
    facts.push(network.hosts[0] + (more ? ` +${more}` : ''));
  }
  return facts;
}

/** One thing a card or a page counts, with the icon it is told by:
 *  `8 functions`, `1 secret`, `graph.microsoft.com +2`. */
export interface AgentStat {
  icon: string;
  text: string;
  /** The whole of it, for a tooltip, where `text` is shortened. */
  title?: string;
}

/** The same facts as `agentFacts`, each with its icon: what a card shows
 *  as a row of small pills rather than one line of words. */
export function agentStats(manifest: Manifest | null | undefined): AgentStat[] {
  const functions = manifest?.functions?.length || 0;
  const network = networkOf(manifest);
  const kept = resourcesOf(manifest);
  const secrets = kept.find((group) => group.kind === 'secrets')?.items.length || 0;
  const records = kept.filter((group) => group.kind !== 'secrets').reduce((sum, group) => sum + group.items.length, 0);
  const stats: AgentStat[] = [{ icon: 'list-checks', text: `${functions} ${functions === 1 ? 'function' : 'functions'}` }];
  if (secrets) stats.push({ icon: 'key-round', text: `${secrets} ${secrets === 1 ? 'secret' : 'secrets'}` });
  if (records) {
    stats.push({ icon: 'database', text: `${records} kept`, title: `Keeps ${records} kind${records === 1 ? '' : 's'} of record or file` });
  }
  if (network.any) {
    stats.push({ icon: 'globe', text: 'the open web' });
  } else if (network.hosts.length) {
    const more = network.hosts.length - 1;
    stats.push({ icon: 'globe', text: network.hosts[0] + (more ? ` +${more}` : ''), title: network.hosts.join(', ') });
  } else if (!network.from_secrets.length) {
    stats.push({ icon: 'lock', text: 'no network', title: 'It connects to nothing outside the platform' });
  }
  return stats;
}

/** A level's place in the order, 0 to 3, by its word. */
export function levelIndex(name: string): number {
  return PERMISSION_LEVELS.indexOf(name);
}

/** The functions by level as the parts of one bar: each level's share of
 *  the whole, in the order of the levels. */
export function levelBar(manifest: Manifest | null | undefined):
  Array<{ name: string; count: number; share: number; index: number }> {
  const tally = levelTally(manifest);
  const total = tally.reduce((sum, level) => sum + level.count, 0) || 1;
  return tally.map((level) => ({ ...level, share: (level.count / total) * 100, index: levelIndex(level.name) }));
}

/** One of the numbers at the head of an agent's page or review. */
export interface AgentCount {
  value: string;
  label: string;
  /** Worth a second look: an outside action, the open web. */
  warn?: boolean;
}

/** The few numbers a careful reader counts first, as one line: its
 *  functions, how many act outside the platform (when any do), where it
 *  connects, and what it keeps (when it keeps anything). The page under
 *  them says the rest. */
export function agentCounts(manifest: Manifest | null | undefined): AgentCount[] {
  const functions = manifest?.functions || [];
  const outside = functions.filter((fn) => fn.level === 3).length;
  const network = networkOf(manifest);
  const hosts = network.hosts.length + network.from_secrets.length;
  const kept = resourcesOf(manifest).reduce((sum, group) => sum + group.items.length, 0);
  const counts: AgentCount[] = [
    { value: String(functions.length), label: functions.length === 1 ? 'function' : 'functions' },
  ];
  if (outside) {
    counts.push({ value: String(outside), label: outside === 1 ? 'acts outside the platform' : 'act outside the platform', warn: true });
  }
  counts.push(network.any
    ? { value: 'Any', label: 'public address', warn: true }
    : hosts ? { value: String(hosts), label: hosts === 1 ? 'host it reaches' : 'hosts it reaches' } : { value: 'No', label: 'network' });
  if (kept) counts.push({ value: String(kept), label: kept === 1 ? 'thing it keeps' : 'things it keeps' });
  return counts;
}

/** One thing an agent keeps, as its row says it. */
export interface KeptItem {
  kind: 'secrets' | 'data' | 'files';
  word: string;
  label: string;
  about: string;
  resource: AgentResource;
}

/** Every secret, record and file a manifest keeps, one row each. */
export function keptItems(manifest: Manifest | null | undefined): KeptItem[] {
  const words = { secrets: 'secret', data: 'record', files: 'file' } as const;
  return resourcesOf(manifest).flatMap((group) => group.items.map((item) => ({
    kind: group.kind,
    word: words[group.kind],
    label: item.label || item.id,
    about: item.description || '',
    resource: item,
  })));
}

/** What a level means, without the "Level n." it begins with: a legend
 *  says the level by its word and colour already. */
export function levelMeaning(name: string): string {
  return (LEVEL_MEANINGS[name] || '').replace(/^Level \d\.\s*/, '');
}

/** The icon an agent is told by, when its name or id says what it is:
 *  mail, a calendar, files. The manifest names none, and initials alone
 *  make a grid of look-alike tiles. Every name here is one the app
 *  registers (app.module.ts); none found is '' and the mark keeps its
 *  initials. */
const ICONS: Array<[RegExp, string]> = [
  [/gmail|outlook|(^|_)mail/, 'mail'],
  [/calendar/, 'calendar-days'],
  [/teams/, 'message-square-text'],
  [/slack|chat/, 'message-square'],
  [/drive|onedrive|dropbox|(^|_)box($|_)/, 'folder-open'],
  [/sheets|excel|spreadsheet/, 'file-spreadsheet'],
  [/slides|powerpoint|deck/, 'presentation'],
  [/docs|word|documents/, 'file-text'],
  [/forms|applications/, 'square-pen'],
  [/todo|tasks|todoist/, 'circle-check'],
  [/timesheet/, 'clock'],
  [/expense|receipt|invoice/, 'receipt-text'],
  [/json/, 'file-braces'],
  [/code_runner|code|terminal/, 'square-terminal'],
  [/connection_check|network/, 'network'],
  [/browser/, 'monitor'],
  [/web_watch|watch/, 'eye'],
  [/feeds|rss|news/, 'scroll-text'],
  [/web_reader|web|places|maps/, 'globe'],
  [/notion|notebook/, 'book-open'],
  [/note/, 'pencil-line'],
];

export function iconOf(manifest: Manifest | null | undefined): string {
  const id = `${manifest?.agent?.id || ''} ${manifest?.agent?.name || ''}`.toLowerCase().replace(/\s+/g, '_');
  return ICONS.find(([pattern]) => pattern.test(id))?.[1] || '';
}

/** The resources a manifest declares, by kind, each with the word a
 *  person reads it by. */
export function resourcesOf(manifest: Manifest | null | undefined):
  Array<{ kind: 'secrets' | 'data' | 'files'; word: string; items: AgentResource[] }> {
  const declared = manifest?.resources || {};
  return ([['secrets', 'Secrets'], ['data', 'Records'], ['files', 'Files']] as const)
    .map(([kind, word]) => ({ kind, word, items: declared[kind] || [] }))
    .filter((group) => group.items.length);
}
