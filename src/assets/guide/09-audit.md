# The audit trail

The platform keeps a line for every change and every refusal. It is written by the platform itself — never by the assistant, and never with a secret's value or a body — and it can only be added to: nobody changes or removes a line. Lines go by age alone, after the time the deployment keeps them.

## What a line says

When; who — a person, a runtime acting for one of their chats, or a webhook; which endpoint or event; the ids it touched; how it ended — success, refused or failed; and why, for one refused.

Among what is recorded:

- every call that changed something, and every call that was refused, whoever made it;
- signing in;
- what a runtime wrote down of a chat's work, such as an agent's call and how it ended;
- a webhook's calls that were refused at the door.

Callers nobody knows are counted, a line a minute for each address, rather than a line each.

## Reading it

- **Organization → Audit**, on *Mine*, is your own lines, newest first.
- On *Organization*, an administrator with the right reads the whole organization's, and can narrow it to one person.
- Either can be narrowed to what was done — an action, or its start, such as `ai:chat` — and to how it ended. A chat's menu opens the lines of that chat alone: **What this chat did**.

## What it is for

- To check a claim: the assistant said it sent the reminder; the trail shows the call, and how it ended.
- To understand a refusal: a refused call says why.
- To answer *who did what*: every line names its actor.
