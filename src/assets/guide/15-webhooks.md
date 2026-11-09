# Webhooks

A webhook lets another service tell one of your chats that something happened — a payment arrived, a ticket was opened, a form was sent — and the assistant acts on it as you asked. The other way, your notifications can be sent to another service too: a Slack channel, a Teams chat, or a system of your own.

Your webhooks are under **AI → Webhooks**, beside Schedules. Notifications to other services are under **Settings → Notifications out**.

## Making a webhook

Press **Make a webhook** and give:

- **A name** — *Stripe payment received*.
- **An instruction** — what the assistant should do each time: *A payment arrived. If it settles an overdue invoice, cancel that customer's reminder and tell me.*
- **The fields** the other service will post: each a name, a type (text, number, yes or no, date, list, object), whether it is required, and a short description. A body with anything else, or without a required field, is refused, so nothing unexpected reaches the chat.
- **Its trust level** — how far its chat may act without asking. Your organization sets the highest a webhook may have.

Each webhook has **one chat of its own**, named after it, which every call wakes. Its model and agents are that chat's own settings, changed in the chat. You may have 25 webhooks.

## The secret, shown once

When the webhook is made you are shown its **address** and its **secret**. Copy the secret then: it is never shown again. **Replace the secret** makes a new one, also shown once, and the old one stops working at once.

The secret calls this webhook and nothing else. It is not an API key: it cannot act as you anywhere.

## What the other service sends

A `POST` to the address, with the secret as `Authorization: Bearer …` and the fields as one JSON object: at most 64 KB, and 60 calls a minute. An `Idempotency-Key` header makes a repeated call answered with the first.

For more safety, turn on **Require a signature**. The service then sends, instead of the secret, the time (`X-DecentAI-Timestamp`, unix seconds) and a signature (`X-DecentAI-Signature`): HMAC-SHA256 with the secret over `<timestamp>.<Idempotency-Key>.<body>`, as hex. The secret never travels; a changed body, an old time or a signature used before is refused.

The service is answered at once; the chat works after. What the webhook received is kept 30 days.

## A webhook's page

Open a webhook to see its **calls**: each, newest first, accepted or refused, and why one was refused. What its chat did with them is in the chat.

- **Send a test** writes a body you fill in into its chat, the way a call would, marked a test, and lists it among its calls.
- **Share** lets people of your organization and groups you are in watch it: they see what it is and the calls it received, never its secret, its settings or its chat, and cannot change it.
- **The switch** beside its name turns it off — calls are refused — and on again without losing anything.
- **Hand over** offers it, with its chat, to another member. It is theirs once they accept; one handed to you waits at the top of the page, to accept or decline.
- **Delete** stops it; its chat is archived, with everything it heard.

## What the assistant does with it

It reads **your instruction** as yours, and the posted fields as **information from outside** — never as instructions. The chat acts as you, with your permissions and its own trust level. Anything above that level waits on a card for your answer. A webhook that only needs to look things up is safest at **level 0**.

An administrator can turn webhooks off for the whole organization on the Safety page.

## Notifications to other services

Under **Settings → Notifications out**, give an address outside your organization's network, a format — **JSON**, **Slack** or **Microsoft Teams** — and the events to send:

- **An approval is waiting for you.**
- **A chat answered while you were away.**
- **A schedule's run finished** / **A schedule's run failed**.

Each notification is a line and a link into the chat. The reply's text is sent only if you choose to include it. A notification that fails is tried again for a day; after twenty failures in a row the address is **paused**. **Send a test** tries one.
