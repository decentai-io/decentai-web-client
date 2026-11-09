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

/** The resources a manifest declares, by kind, each with the word a
 *  person reads it by. */
export function resourcesOf(manifest: Manifest | null | undefined):
  Array<{ kind: 'secrets' | 'data' | 'files'; word: string; items: AgentResource[] }> {
  const declared = manifest?.resources || {};
  return ([['secrets', 'Secrets'], ['data', 'Records'], ['files', 'Files']] as const)
    .map(([kind, word]) => ({ kind, word, items: declared[kind] || [] }))
    .filter((group) => group.items.length);
}
