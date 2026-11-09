# API keys

An API key lets a script act as you: an integration, a job that runs outside the platform.

## What a key is

A key **is you**. Every call it makes is checked against your own permissions, at that moment: a group you were removed from a minute ago governs the next call. It grants nothing you lack, and stops when you are disabled or removed.

## Making one

Open **Settings → API keys** and make a key: give it a name you will recognise later — the script, the machine — and how many days it lasts, at most 365. The key is shown **once**. Copy it then; the page cannot show it again, because only its hash is kept.

You may hold twenty keys. Revoke one when its script is retired; calls with it are refused from then on. A key ends by itself when its days run out.

## Using one

Send it as a bearer token to the API server's address — the one the sign-in page shows, not this app's:

```
POST https://<the API server's address>/app
Authorization: Bearer dk_…
Content-Type: application/json

{"endpoint": "Data:Record:list", "data": {"of": {"agent": "tasks", "resource": "task"}}}
```

Every call has one shape: an `endpoint` named `Domain:Name:action` and a `data` object. An answer is `200` with its result; a refusal is its status and `{"error": {"code", "message"}}`, the message in words, and `retry_after` when there were too many calls. The same endpoints the pages call are open to a key, subject to your permissions. Some examples:

| Endpoint | What it does |
|---|---|
| `Data:Record:list` | Records you can see, narrowed to a resource or by plain values |
| `Data:Record:create` | A record of a resource an agent declares, as `fields` |
| `AI:Chat:list` | Your chats |
| `AI:Chat:input` | Write in a chat |
| `AI:Audit:list` | Your audit trail, a page at a time |

A file's bytes go up to `POST /upload?name=…` and come back from `GET /download/<record id>`.

## What a key cannot do

Anything you cannot. It acts with your rights, no more.
