import { Injectable } from '@angular/core';

import { Failure, Refused, RequestService } from './request.service';

/** What the person wished: absent is yes. */
export interface NotificationWishes {
  push?: boolean;
  email?: boolean;
  /** Say what happened, rather than only that something did. */
  text?: boolean;
}

/** How this person is reached when a chat needs them. */
export interface NotificationSettings {
  wishes: NotificationWishes;
  /** The deployment's web push key; empty where web push is not set up. */
  push_key: string;
  /** Whether the deployment sends mail. */
  email: boolean;
  /** How many browsers of theirs are pushed to. */
  devices: number;
}

/** Client for Settings:Notifications. */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  constructor(private request: RequestService) {}

  async get(): Promise<NotificationSettings> {
    const r = await this.request.gateway('Settings:Notifications:get');
    if (r.error) throw new Refused(r.error);
    return r;
  }

  /** Let this browser be pushed to: its subscription's endpoint and keys. */
  subscribe(subscription: PushSubscriptionJSON): Promise<Failure> {
    return this.request.gateway('Settings:Notifications:subscribe', {
      endpoint: subscription.endpoint, keys: subscription.keys,
    });
  }

  unsubscribe(endpoint: string): Promise<Failure> {
    return this.request.gateway('Settings:Notifications:unsubscribe', { endpoint });
  }

  /** Change some wishes; the answer holds the ones changed. */
  update(wishes: NotificationWishes): Promise<{ wishes?: NotificationWishes } & Failure> {
    return this.request.gateway('Settings:Notifications:update', wishes);
  }

  /** A test, to every browser of theirs that is pushed to. */
  test(): Promise<Failure> {
    return this.request.gateway('Settings:Notifications:test');
  }
}
