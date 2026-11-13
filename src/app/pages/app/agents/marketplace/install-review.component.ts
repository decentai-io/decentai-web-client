import { Component, Input } from '@angular/core';
import { MarkdownService } from 'ngx-markdown';

import { headingsDown } from 'src/app/components/ui/markdown-levels';
import { AgentSource, CatalogOffer, Manifest } from 'src/app/services/agents.service';
import { ChatMarkdownService } from '../../ai/chat/chat-message/chat-markdown.service';
import {
  AgentCount, AgentNetwork, KeptItem, agentCounts, credentialHost, iconOf, keptItems, levelBar, levelLabel,
  levelMeaning, levelTally, networkNote, networkOf, resourcesOf,
} from '../agent-shared';

/** The machines a program may be built for, as a person reads them. */
const MACHINES: Record<string, string> = {
  x86_64: 'Intel or AMD (x86-64)',
  aarch64: 'ARM (aarch64)',
};

/** How long a README is shown whole; a longer one is folded. */
const README_FOLD_CHARS = 900;

let created = 0;

/**
 * What installing one agent would agree to, in the order a careful
 * person reads it: what it is and its README, what an update changes,
 * what it keeps, where it connects, what it may do, and what it runs
 * on. The page around it (the title, Install) is the marketplace's; in
 * a review of several agents each is one of these, in brief.
 *
 * On an update it also says what CHANGED: a version number says
 * something is different, this says what, which is the only form of the
 * question an administrator can actually answer.
 *
 * Nothing here has run. A catalog is read without executing a line of
 * it, and installing is what turns an offer into an agent.
 */
@Component({
  selector: 'app-install-review',
  standalone: false,
  templateUrl: './install-review.component.html',
  styleUrls: ['../agent-shared.css', './install-review.component.css'],
  // A README is somebody else's markdown: what it would load from
  // elsewhere is taken out, as in a chat.
  providers: [{ provide: MarkdownService, useClass: ChatMarkdownService }],
})
export class InstallReviewComponent {
  @Input({ required: true }) source!: AgentSource;
  @Input({ required: true }) offer!: CatalogOffer;
  /** The manifest installed now, when this is an update. Absent for a
   *  first install: there is nothing to compare with. */
  @Input() approved: Manifest | null = null;
  /** One of several agents under review: its own name at the head, no
   *  README, and the functions folded. */
  @Input() brief = false;

  /** For the ids that tie each section to its title. */
  readonly id = `reading-${++created}`;
  readmeOpen = false;

  readonly credentialHost = credentialHost;

  get manifest(): Manifest {
    return this.offer.manifest;
  }

  get name(): string {
    return this.manifest.agent.name || this.manifest.agent.id;
  }

  get icon(): string {
    return iconOf(this.manifest);
  }

  get tally(): Array<{ name: string; count: number }> {
    return levelTally(this.manifest);
  }

  /** Its functions by level, as the parts of one bar; the same array
   *  until the manifest changes. */
  get bar(): Array<{ name: string; count: number; share: number; index: number }> {
    if (this.barOf !== this.manifest) {
      this.barOf = this.manifest;
      this.barShown = levelBar(this.manifest);
    }
    return this.barShown;
  }
  private barOf: Manifest | null = null;
  private barShown: Array<{ name: string; count: number; share: number; index: number }> = [];

  get barWords(): string {
    return this.bar.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(', ');
  }

  readonly meaningOf = levelMeaning;

  /** The numbers at its head, the same array until the manifest changes. */
  get counts(): AgentCount[] {
    if (this.countsOf !== this.manifest) {
      this.countsOf = this.manifest;
      this.countsShown = agentCounts(this.manifest);
    }
    return this.countsShown;
  }
  private countsOf: Manifest | null = null;
  private countsShown: AgentCount[] = [];

  get resources() {
    return resourcesOf(this.manifest);
  }

  /** Every secret, record and file it keeps, one row each. */
  get kept(): KeptItem[] {
    if (this.keptOf !== this.manifest) {
      this.keptOf = this.manifest;
      this.keptShown = keptItems(this.manifest);
    }
    return this.keptShown;
  }
  private keptOf: Manifest | null = null;
  private keptShown: KeptItem[] = [];

  /** The kinds a group keeps, by name. */
  kindsOf(group: { items: { id: string; label?: string }[] }): string {
    return group.items.map((item) => item.label || item.id).join(', ');
  }

  /** The README with its headings two levels down: the page has the one
   *  `h1`, and "About" is an `h2` above them. */
  get readme(): string {
    const written = this.offer.readme || '';
    if (written !== this.readmeWritten) {
      this.readmeWritten = written;
      this.readmeShown = headingsDown(written, 2);
    }
    return this.readmeShown;
  }
  private readmeWritten = '';
  private readmeShown = '';

  get readmeLong(): boolean {
    return (this.offer.readme || '').length > README_FOLD_CHARS;
  }

  /** The machines it has a program for, as a person reads them. */
  get machines(): string[] {
    return this.offer.machines.map((machine) => MACHINES[machine] || machine);
  }

  get network(): AgentNetwork {
    return networkOf(this.manifest);
  }

  get networkNote(): string {
    return networkNote(this.network);
  }

  /** What installing this update changes. Empty on a first install, and
   *  on an update that changes none of it. */
  get changes(): string[] {
    const approved = this.approved;
    if (!approved) return [];
    const lines: string[] = [];
    const before = new Map(approved.functions.map((fn) => [fn.id, fn]));
    const now = new Set(this.manifest.functions.map((fn) => fn.id));
    for (const fn of this.manifest.functions) {
      const was = before.get(fn.id);
      if (!was) lines.push(`New function: ${fn.id} (${levelLabel(fn.level)})`);
      else if (was.level !== fn.level) lines.push(`${fn.id}: ${levelLabel(was.level)} → ${levelLabel(fn.level)}`);
      const calls = (fn.calls || []).filter((call) => !(was?.calls || []).includes(call));
      if (was && calls.length) lines.push(`${fn.id} may now call ${calls.join(', ')}`);
    }
    for (const fn of approved.functions) {
      if (!now.has(fn.id)) lines.push(`Function removed: ${fn.id}`);
    }
    lines.push(...this.networkChanges(networkOf(approved), this.network));
    const kept = new Set(resourcesOf(approved).flatMap((group) => group.items.map((item) => `${group.kind}:${item.id}`)));
    for (const group of this.resources) {
      for (const item of group.items) {
        if (!kept.has(`${group.kind}:${item.id}`)) lines.push(`Now keeps ${group.word.toLowerCase()}: ${item.label || item.id}`);
      }
    }
    return lines;
  }

  /** What an update changes about where the agent connects. Only what
   *  widens is worth a line: a host it did not reach before. */
  private networkChanges(before: AgentNetwork, after: AgentNetwork): string[] {
    if (after.any) return before.any ? [] : ['Now connects to any public address'];
    if (before.any) return [];
    const had = new Set([...before.hosts, ...before.from_secrets]);
    return [
      ...(after.opens && !before.opens ? ['May now ask to open other hosts for a call, shown to you first'] : []),
      ...after.hosts.filter((host) => !had.has(host)).map((host) => `New host: ${host}`),
      ...after.from_secrets.filter((field) => !had.has(field)).map((field) => `New host, read from a secret: ${field}`),
    ];
  }
}
