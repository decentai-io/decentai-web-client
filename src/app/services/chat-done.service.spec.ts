import { Subject } from 'rxjs';

import { Chat, DEFAULT_CHAT_SETTINGS } from '../models/chat-protocol';
import { ChatDoneService, QUIET_READS, doneLine, markedTitle, readWatched } from './chat-done.service';

describe('ChatDoneService', () => {
  const chat = (chat_id: string, working: boolean, title = 'Trip'): Chat => ({
    chat_id, title, preview: '', settings: DEFAULT_CHAT_SETTINGS, archived: false, working, held: true, webhook: '',
    created_at: '', updated_at: '',
  });
  let listed: Chat[];
  let tabTitle: string;
  let visibility: DocumentVisibilityState;
  let service: ChatDoneService;
  let snackBar: { open: jasmine.Spy };
  let router: { navigate: jasmine.Spy };
  let listChats: jasmine.Spy;

  beforeEach(() => {
    jasmine.clock().install();
    listed = [];
    tabTitle = 'Settings · DecentAI';
    visibility = 'visible';
    spyOnProperty(document, 'visibilityState', 'get').and.callFake(() => visibility);
    listChats = jasmine.createSpy('listChats').and.callFake(async () => listed);
    const action = new Subject<void>();
    snackBar = { open: jasmine.createSpy('open').and.returnValue({ onAction: () => action }) };
    router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    service = new ChatDoneService(
      { listChats } as any, router as any, snackBar as any,
      { getTitle: () => tabTitle, setTitle: (title: string) => (tabTitle = title) } as any,
      { run: (fn: () => void) => fn() } as any,
    );
    service.enabled = true;
    service.start();
  });

  afterEach(() => {
    service.stop();
    service.enabled = true;
    jasmine.clock().uninstall();
  });

  /** The answers awaited inside a read, all in. */
  async function settled(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  /** The person sends in a chat, it gets to work, and they leave it working. */
  function leaveWorking(chatId: string): void {
    service.opened(chatId);
    service.began(chatId, 'Trip', false);
    service.working(chatId);
    service.closed(chatId, 'Trip', true);
  }

  it('reads the chats left working every few seconds, and tells once when one is done', async () => {
    leaveWorking('c1');
    listed = [chat('c1', true)];
    jasmine.clock().tick(ChatDoneService.POLL_MS);
    expect(listChats).toHaveBeenCalledTimes(1);
    await settled();
    expect(snackBar.open).not.toHaveBeenCalled();

    listed = [chat('c1', false, 'Trip to Rome')];
    await service.poll();
    expect(snackBar.open).toHaveBeenCalledOnceWith('“Trip to Rome” is done', 'Open', jasmine.any(Object));

    // Nothing is left to watch: the list is not read again.
    const reads = listChats.calls.count();
    jasmine.clock().tick(ChatDoneService.POLL_MS * 3);
    await service.poll();
    expect(listChats.calls.count()).toBe(reads);
    expect(snackBar.open).toHaveBeenCalledTimes(1);
  });

  it('says nothing for the chat the person is looking at, and nothing they did not set working', () => {
    service.opened('c1');
    service.began('c1', 'Trip', false);
    service.working('c1');
    service.idle('c1', 'Trip');
    service.idle('c2', 'Other');
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('waits for the work to begin: a quiet chat just after a send is not done', () => {
    service.opened('c1');
    service.began('c1', 'Trip', false);
    service.idle('c1', 'Trip');
    expect(snackBar.open).not.toHaveBeenCalled();
    service.working('c1');
    service.idle('c1', 'Trip');
    // On the chat, in view: nothing to say.
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('marks the tab while it is hidden, and says it on the person\'s return', () => {
    service.opened('c1');
    service.began('c1', 'Trip', true);
    service.opened('c2');
    visibility = 'hidden';
    service.idle('c1', 'Trip');
    expect(tabTitle).toBe('(1) Settings · DecentAI');
    expect(snackBar.open).not.toHaveBeenCalled();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(tabTitle).toBe('Settings · DecentAI');
    expect(snackBar.open).toHaveBeenCalledOnceWith('“Trip” is done', 'Open', jasmine.any(Object));
  });

  it('says nothing when the person turned it off on this device', async () => {
    service.enabled = false;
    expect(service.enabled).toBeFalse();
    leaveWorking('c1');
    listed = [chat('c1', false)];
    await service.poll();
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('reads a chat as done only once it was seen working, and lets go of one gone or never begun', () => {
    const held = { title: '', seen: false, quiet: 0 };
    expect(readWatched(held, chat('c1', true))).toBe('working');
    expect(readWatched(held, chat('c1', false))).toBe('waiting');
    expect(readWatched({ ...held, quiet: QUIET_READS - 1 }, chat('c1', false))).toBe('gone');
    expect(readWatched({ ...held, seen: true }, chat('c1', false))).toBe('done');
    expect(readWatched(held, undefined)).toBe('gone');
    expect(markedTitle('(2) Chats', 3)).toBe('(3) Chats');
    expect(markedTitle('(2) Chats', 0)).toBe('Chats');
    expect(doneLine('')).toBe('Your chat is done');
  });
});
