# Organization settings and monitoring

What the organization is set up with, and what it can see of its agents: the model connections the assistant thinks with, speech, the apps members connect their accounts through, what no agent may do, the computers chats run on, and what was used. All but Monitoring are under **Settings**, changed by administrators; Monitoring is its own page, under **Organization**.

## Model providers

**Settings → Model providers** holds the organization's model connections: a provider, its address, its key, and the models people may pick from it, shared with groups. Adding one is picking the provider and pasting its key; its newest model is chosen as the default, and others are added with a click. The key is encrypted and never shown again; changing the address asks for it again. **Test connection** asks a runtime, which is what calls models, whether the connection answers, before it is saved.

One connection is the organization's default: a chat that chose none uses it, with that connection's default model. A person's chats may use any model of a connection shared with a group of theirs.

## Speech

**Settings → Speech** says what writes a spoken message down and says a reply aloud: the platform's speech service, a model connection with its models and voice, or nothing. Audio is at most 10 MB.

## Connected apps

**Settings → Connected apps** holds the organization's registration of each provider's app — Google, Microsoft, Slack — so members can connect their accounts with a click: its client id, its secret, and its addresses for consent, tokens and the account. The secret is encrypted and never shown again; changing an address asks for it again. A secret's resource connects only through its organization's registration for that provider, and only when the agent sends its sign-ins to the addresses registered. *Connecting apps* has the steps for each provider.

## Safety

**Settings → Safety** holds what the organization decides for every chat:

- **Blocked hosts.** Hosts no agent may reach, whatever its manifest declares, `*.example.com` included.
- **Your organization's rules for the assistant.** Up to 4,000 characters added to every chat's instructions: what to avoid, how to answer, what to check first. They make the assistant more careful, never less; keep what must never happen in policies and blocked hosts. Do not write a secret in them.
- **MCP servers.** Whether people may add them.
- **Webhooks.** Whether webhooks may wake chats, and notifications go to outside addresses; and the highest trust level a webhook's chat may run at.
- **What a notification says.** What happened, or only that something did, with a link to the chat.

## Nodes

**Settings → Nodes** shows the runtimes that serve the organization: what each reports — the chats it holds and its sandboxes, with their room and what runs on them. An administrator may name one, drain it or one of its sandboxes — nothing new is placed there, and what runs goes on — refuse it by its id, and forget one that is gone. The page also says where the organization's chats may run: on its own runtimes first, or on them only. Runtimes and sandboxes join with enrollment tokens made there, each shown once, with a lifetime and a number of uses.

## Monitoring

**Organization → Monitoring** shows what was used. Each person sees their own usage: tokens, by day, provider and model. An administrator also sees the organization's: by person, agent, model and day, with its cost where the model's prices are known; what its runtimes run, processes and memory for each agent; what the runtimes reported of its chats; and the audit trail summed up by what happened and how it ended. Nothing on the page changes anything.
