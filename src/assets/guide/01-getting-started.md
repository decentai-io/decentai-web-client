# Getting started

DecentAI is a workspace where an assistant does real work for you through **agents** — reviewed programs that can read a mailbox, keep records, fill a document, compare quotations — and where everything an agent does is gated by your organization's policies, asked of you when it should be, and written on an audit trail.

This guide walks the workspace in the order you will meet it. Read this chapter and the next, then come back to the others as you need them.

## Signing in

The app speaks to a DecentAI **API server**: the server your organization runs. Where the app was not told which, its first screen asks for its address — whoever runs DecentAI gives it to you, as `https://decentai.example.com` — and the browser keeps it. *Change*, under the sign-in form, picks another.

You join an organization when its administrator invites you by email; the invitation link lets you choose your name and a password. Where DecentAI sends no email, they add you and hand you a temporary password, which you replace with your own the first time you sign in. A password is 10 to 256 characters.

Whoever opens a DecentAI nobody is in yet meets the first-run page instead: with the setup code its operator gives them, they name the organization, choose their own email and password, and are its administrator. Where the deployment allows it, the sign-in page also offers to create an organization of your own: a link is emailed to you, and following it makes the organization, with you as its administrator.

If you forget your password, *Forgot your password?* sends a reset link to your address, where DecentAI sends email; otherwise an administrator gives you a temporary one. Too many wrong tries close the door for a while, for the right password as for a wrong one.

*Keep me signed in on this device* keeps you signed in for ninety days rather than seven. Leave it off on a computer that is not yours.

## The workspace

The sidebar on the left is the map:

| Section | What is there |
|---|---|
| **AI → Chats** | Where you ask for things. Each chat keeps its own messages and its own settings: its agents, model, trust level and time zone. |
| **AI → Schedules** | What waits for you across your chats, and what they keep on the clock. |
| **AI → Webhooks** | Addresses other services post events to, each waking a chat of its own. |
| **Agents** | The agents your organization installed, and the marketplace they come from. |
| **Data** | Files, records agents keep for you, skills, tools (MCP servers), and secrets. |
| **Organization** | **Settings** — yours (chat defaults, notifications, memory, API keys) and the organization's (model providers, speech, connected apps, safety, nodes) — then **Monitoring** and **Audit**. |
| **Guide** | This guide, at the foot of the sidebar. |

People, groups and policies are not in the sidebar. Whoever administers the organization opens the menu on their name and chooses **Admin console**: the sidebar shows **Account** with your Profile, and **IAM** with Organization, Users, Groups and Policies.

What you see depends on what your organization's policies allow you. A page you cannot use is not shown.

## Your first chat

1. Open **AI → Chats** and type into the box at the top to start a new chat. Your earlier chats are listed underneath it.
2. Choose which agents it may use in the chat's settings. A chat that names none uses every agent you may use.
3. Ask for something in plain words. For example, with the Notebook agent installed:

> Save a note in my "work" notebook titled "Ideas for Q4" with three bullet points about the Harbourline fit-out.

The assistant calls the agent it needs, and answers. While it works the chat shows what it is doing: each call it makes, as it starts and as it ends. An agent can show you things itself, a table or a chart, and hand back files you can open or download.

## Three things worth knowing early

- **Trust level.** Every agent function says how far it reaches: 0 only reads, 1 makes an ordinary change, 2 a wider change, 3 acts outside the platform. A chat's **trust level** is how far its agents may go without asking. Above it, the chat stops and asks you on a card first.
- **Policies decide, too.** Your organization's policies say which agents and functions you may use at all, and may say a function always asks.
- **Everything is recorded.** Every change and every refusal is a line of the audit trail, written by the platform, never by the assistant, and never with a secret's value. **Organization → Audit** shows yours.

Next: [Chats](/guide/chats), where most of the work happens.
