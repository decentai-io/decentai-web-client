import { ChatMessagesContainerComponent } from './chat-messages-container.component';

/** A scroll container that behaves like the browser's: a programmatic
 *  scroll raises scroll events of its own, which is the whole reason the
 *  thread used to stop short of its end. */
class FakeScroller {
  scrollTop = 0;
  clientHeight = 800;
  scrollHeight = 5000;
  /** Positions to report while a scroll we started is under way. */
  frames: number[] = [];
  private onScroll: () => void = () => {};

  watch(handler: () => void) {
    this.onScroll = handler;
  }

  scrollTo(options: { top: number }) {
    // The frames the animation passes through before it lands.
    for (const top of this.frames) {
      this.scrollTop = top;
      this.onScroll();
    }
    this.scrollTop = options.top;
    this.onScroll();
  }
}

describe('ChatMessagesContainerComponent following the foot of the thread', () => {
  function containerWith(el: FakeScroller) {
    const ngZone = {
      runOutsideAngular: (fn: () => void) => fn(),
      run: (fn: () => void) => fn(),
    };
    const component = new ChatMessagesContainerComponent(ngZone as any);
    (component as any).messagesContainer = { nativeElement: el };
    el.watch(() => component.onScroll());
    return component;
  }

  it('keeps following when the scroll events come from our own move', () => {
    const el = new FakeScroller();
    // Half way down, a frame of our own animation looks exactly like a
    // person who has scrolled away from the end.
    el.frames = [1200, 2600];
    const component = containerWith(el);

    (component as any).scrollToBottom(true);

    expect((component as any).userNearBottom).toBe(true);
  });

  it('stops following when the person scrolls away themselves', () => {
    const el = new FakeScroller();
    const component = containerWith(el);

    el.scrollTop = 2000;
    component.onScroll();

    expect((component as any).userNearBottom).toBe(false);
  });

  it('chases content that arrives after the move, instead of landing short', () => {
    const el = new FakeScroller();
    const component = containerWith(el);

    (component as any).scrollToBottom(false);
    expect(el.scrollTop).toBe(5000);

    // A table is drawn and the thread grows underneath us. This is
    // what the resize observer does, and it only does it while the thread
    // is still considered followed.
    el.scrollHeight = 5600;
    if ((component as any).userNearBottom) (component as any).scrollToBottom(false);

    expect(el.scrollTop).toBe(5600);
  });

  it('asks for an instant move when it is not meant to glide', () => {
    const el = new FakeScroller();
    const component = containerWith(el);
    const asked: string[] = [];
    (el as any).scrollTo = (options: { top: number; behavior: string }) => {
      asked.push(options.behavior);
      el.scrollTop = options.top;
    };

    (component as any).scrollToBottom(false);
    (component as any).scrollToBottom(true);

    expect(asked).toEqual(['auto', 'smooth']);
  });
});

describe('ChatMessagesContainerComponent, a turn’s work', () => {
  function container() {
    return new ChatMessagesContainerComponent({
      runOutsideAngular: (fn: () => void) => fn(),
      run: (fn: () => void) => fn(),
    } as any);
  }

  function turnOn(component: ChatMessagesContainerComponent, processing: boolean) {
    const was = component.isProcessing;
    component.isProcessing = processing;
    component.ngOnChanges({ isProcessing: { currentValue: processing, previousValue: was,
      firstChange: false, isFirstChange: () => false } } as any);
  }

  it('shows three dots while a turn is thought about', () => {
    const component = container();
    expect(component.showLiveWork).toBeFalse();
    expect(component.thinking).toBeFalse();

    turnOn(component, true);
    expect(component.thinking).toBeTrue();
    expect(component.showLiveWork).toBeFalse();
  });

  it('has a work card once something runs, and says what runs', () => {
    const component = container();
    turnOn(component, true);
    component.steps = { '': [{ id: 'work:w1', text: 'Saving the note', status: 'running' }] };
    expect(component.showLiveWork).toBeTrue();
    expect(component.thinking).toBeTrue();
    expect(component.liveLine).toBe('Working · 1 running');
  });

  it('does not end the turn on a blink of the flag', () => {
    jasmine.clock().install();
    try {
      const component = container();
      turnOn(component, true);
      turnOn(component, false);
      expect(component.busy).toBeTrue();
      turnOn(component, true);
      jasmine.clock().tick(2000);
      expect(component.busy).toBeTrue();

      turnOn(component, false);
      jasmine.clock().tick(1000);
      expect(component.busy).toBeFalse();
      expect(component.thinking).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
