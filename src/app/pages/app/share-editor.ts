import { Peer, PeerGroup, Peers } from 'src/app/services/profile.service';

export type ShareMode = 'private' | 'groups' | 'people' | 'org';

/** Whom a thing belongs to: people and groups, by id. */
export interface ResourceOwner {
  groups?: string[];
  users?: string[];
}

/** Who sees a thing, as a row's chip: a word, and what is behind it. */
export interface SharingChip {
  word: string;
  names: string;
}

/** Up to two names as they are, then the first and how many more. */
function listed(names: string[]): string {
  return names.length <= 2 ? names.join(', ') : `${names[0]} and ${names.length - 1} others`;
}

/**
 * Who can see one thing — only me, my groups, specific people, or the
 * whole organization — and the owner map it turns into.
 *
 * Records, skills, MCP servers and webhooks all need exactly the same
 * thing, so it lives here, as plain state a page can hold, open and
 * save. Not a component: the pages differ in where the control sits and
 * what else is being edited beside it. What must not differ is the
 * reading and the writing of the owner map, which is all this owns.
 *
 * The whole organization is its Everyone group, by id; a person shares
 * only into groups they are in.
 */
export class ShareEditor {
  mode: ShareMode = 'private';
  groups = new Set<string>();
  users = new Set<string>();

  /** Whom the person may share with: the page loads this once, through
   *  ProfileService.peers(). */
  peers: Peers = { people: [], groups: [], everyone: '', mine: [] };

  /** The thing being shared, or '' when the editor is closed. */
  ref = '';
  saving = false;

  constructor(private me: () => string) {}

  // ── The person's own position ───────────────────────────────────────

  get myUserId(): string {
    return this.me();
  }

  /** Groups the person may share into: the ones they are in. */
  get myGroups(): PeerGroup[] {
    return this.peers.groups.filter((group) => this.peers.mine.includes(group.group_id));
  }

  /** Everyone the person may share with but themselves. */
  get others(): Peer[] {
    return this.peers.people.filter((person) => person.user_id !== this.myUserId);
  }

  // ── Opening and closing ─────────────────────────────────────────────

  open(ref: string, owner: ResourceOwner | undefined): void {
    this.ref = ref;
    const everyone = this.peers.everyone;
    const groups = owner?.groups ?? [];
    const others = (owner?.users ?? []).filter((id) => id !== this.myUserId);
    if (everyone && groups.includes(everyone)) {
      this.mode = 'org';
    } else if (groups.length) {
      this.mode = 'groups';
    } else if (others.length) {
      this.mode = 'people';
    } else {
      this.mode = 'private';
    }
    this.groups = new Set(groups.filter((id) => id !== everyone));
    this.users = new Set(others);
  }

  close(): void {
    this.ref = '';
    this.saving = false;
  }

  isOpen(ref: string): boolean {
    return this.ref === ref;
  }

  toggleGroup(groupId: string): void {
    if (!this.groups.delete(groupId)) this.groups.add(groupId);
  }

  toggleUser(userId: string): void {
    if (!this.users.delete(userId)) this.users.add(userId);
  }

  /** Choosing "my groups" or "specific people" with nothing ticked
   *  would silently save as private, which is not what was said. */
  get ready(): boolean {
    if (this.mode === 'groups') return this.groups.size > 0;
    if (this.mode === 'people') return this.users.size > 0;
    return true;
  }

  // ── What gets saved ─────────────────────────────────────────────────

  owner(): { groups: string[]; users: string[] } {
    const me = [this.myUserId];
    if (this.mode === 'org') return { groups: [this.peers.everyone], users: me };
    if (this.mode === 'groups') return { groups: Array.from(this.groups), users: me };
    if (this.mode === 'people') {
      return { groups: [], users: [...me, ...Array.from(this.users).filter((u) => u !== this.myUserId)] };
    }
    return { groups: [], users: me };
  }

  // ── What gets shown ─────────────────────────────────────────────────

  /** A person's name, by id, from the peers; '' for one not known. */
  personName(userId: string): string {
    return this.peers.people.find((person) => person.user_id === userId)?.name ?? '';
  }

  /** Who sees a thing, for its row: the groups or the people by name,
   *  "Everyone", "Private", or, on somebody else's, whose it is, which
   *  is what the reader does not know. A private thing still names its
   *  maker in owner.users, so only a group, or a person who is neither
   *  me nor the maker, counts as shared. */
  chip(owner: ResourceOwner | undefined, createdBy: string): SharingChip {
    const groups = owner?.groups ?? [];
    const everyone = !!this.peers.everyone && groups.includes(this.peers.everyone);
    // An id with no name behind it is a group or a person that is gone.
    const groupNames = groups.filter((id) => id !== this.peers.everyone)
      .map((id) => this.peers.groups.find((group) => group.group_id === id)?.name || 'a deleted group');
    const people = (owner?.users ?? []).filter((id) => id !== this.myUserId && id !== createdBy)
      .map((id) => this.personName(id) || 'someone who left');

    if (createdBy !== this.myUserId) {
      return {
        word: `Shared by ${this.personName(createdBy) || 'a colleague'}`,
        names: everyone ? 'With everyone in the organization'
          : groupNames.length ? `With ${groupNames.join(', ')}` : '',
      };
    }
    if (everyone) return { word: 'Everyone', names: 'Everyone in the organization' };
    if (groupNames.length) return { word: listed(groupNames), names: groupNames.join(', ') };
    if (people.length) return { word: listed(people), names: people.join(', ') };
    return { word: 'Private', names: '' };
  }
}
