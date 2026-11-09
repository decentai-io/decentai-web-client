import { NgZone } from '@angular/core';

import { ChatEvent } from 'src/app/models/chat-protocol';
import { ChatConnectionService } from './chat-connection.service';

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string, public protocols: string[]) { FakeSocket.instances.push(this); }
  send(value: string) { this.sent.push(value); }
  close() {}
}

describe('ChatConnectionService', () => {
  let originalWebSocket: typeof WebSocket;
  let service: ChatConnectionService;
  let shell: jasmine.SpyObj<any>;
  let after = 0;

  beforeEach(() => {
    originalWebSocket = window.WebSocket;
    FakeSocket.instances = [];
    (window as any).WebSocket = FakeSocket;
    after = 0;
    const ai = {
      buildChatWsUrl: (chatId: string, seq: number) => `ws://api/chats/${chatId}?after=${seq}`,
      chatWsProtocols: () => ['bearer', 'tok'],
    };
    shell = jasmine.createSpyObj('ShellStatusService', ['sessionEnded']);
    service = new ChatConnectionService(ai as any, new NgZone({ enableLongStackTrace: false }), shell);
  });

  afterEach(() => {
    service.disconnect();
    (window as any).WebSocket = originalWebSocket;
  });

  it('opens from where the page left off, with the token as the subprotocol', () => {
    after = 12;
    service.connect('c1', () => after);
    expect(FakeSocket.instances[0].url).toBe('ws://api/chats/c1?after=12');
    expect(FakeSocket.instances[0].protocols).toEqual(['bearer', 'tok']);
  });

  it('passes on events and nothing else, and sends over the open socket', () => {
    const events: ChatEvent[] = [];
    service.events$.subscribe((event) => events.push(event));
    service.connect('c1', () => after);
    const socket = FakeSocket.instances[0];
    socket.onopen?.();
    expect(service.state$.value).toBe('connected');

    socket.onmessage?.({ data: JSON.stringify({ seq: 3, event: 'working', data: {}, at: 'now' }) });
    socket.onmessage?.({ data: JSON.stringify({ answer: {}, status: 200, id: 'x' }) });
    socket.onmessage?.({ data: 'not json' });
    expect(events.map((event) => event.event)).toEqual(['working']);

    expect(service.send('AI:Chat:screen', { call: 'k1', input: [] })).toBeTrue();
    expect(JSON.parse(socket.sent[0])).toEqual({ endpoint: 'AI:Chat:screen', data: { call: 'k1', input: [] } });
  });

  it('dials again after a drop, from the newest event taken, and ignores the old socket', () => {
    jasmine.clock().install();
    try {
      service.connect('c1', () => after);
      const first = FakeSocket.instances[0];
      first.onopen?.();
      after = 40;
      first.onclose?.({ code: 1006 });
      expect(service.state$.value).toBe('reconnecting');
      jasmine.clock().tick(1000);
      expect(FakeSocket.instances.length).toBe(2);
      expect(FakeSocket.instances[1].url).toBe('ws://api/chats/c1?after=40');

      first.onclose?.({ code: 1006 });
      expect(FakeSocket.instances.length).toBe(2);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('stops for good when the API server closes the socket itself', () => {
    jasmine.clock().install();
    try {
      service.connect('c1', () => after);
      FakeSocket.instances[0].onclose?.({ code: 4403 });
      expect(service.state$.value).toBe('missing');
      expect(shell.sessionEnded).not.toHaveBeenCalled();
      jasmine.clock().tick(10000);
      expect(FakeSocket.instances.length).toBe(1);

      service.connect('c1', () => after);
      FakeSocket.instances[1].onclose?.({ code: 4401 });
      expect(service.state$.value).toBe('signed-out');
      expect(shell.sessionEnded).toHaveBeenCalled();
      jasmine.clock().tick(10000);
      expect(FakeSocket.instances.length).toBe(2);

      // Asked, it dials again.
      service.reconnectNow();
      expect(FakeSocket.instances.length).toBe(3);
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
