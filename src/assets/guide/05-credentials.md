# Secrets

A secret is what an agent signs in with: a login, an API token, an account you connect. Its values are encrypted, never shown again on any page, and never given to the assistant's model. Only an agent the secret lists receives them, when one of its functions runs.

## Where they live

**Data → Secrets** is the page. Every secret is of a resource an installed agent declares: the fields it has, which are plain — a host, an account name, kept so lists can show them — and which are encrypted. Nobody writes the form by hand: it comes from the manifest that was reviewed.

You may make one yourself, or an agent makes one as it works: a secret it creates with a field left empty is put before you on a card, and you fill it in there.

## Connected accounts

Some secrets are not typed in: the resource connects an account through its provider, Google, Microsoft or Slack say. You sign in with the provider in a new window, allow what the agent asked for, and come back with the secret connected. The platform keeps the tokens and renews them; the agent only ever receives a short-lived access token. If the provider stops accepting the grant, the agent says so, and connecting again replaces it.

Connecting needs the organization to have registered its app with that provider once, under **Settings → Connected apps**.

## Logins for sites

An agent that signs in to sites it cannot know in advance — a browser agent most of all — keeps logins with a *form* field: what each site's form asks, each a text or a secret. When it meets a form it has no answers for, it asks you on a card. An answer marked not to be remembered, like a code a site sends you each time, is handed to the agent once and kept nowhere.

## Which agents may use one

A secret lists its agents, each with the resource of its own the secret serves; at first, the agent it was made for. You may add another agent by hand, choosing which of its resources the secret serves: it is allowed only when the kinds match and the secret has every field that resource requires, by the same name and type. Only you add an agent; an agent never does.

Reading a secret's values is a level 2 action for an agent, so a chat below that trust asks you first.

## Sharing and handing on

A secret is yours until you share it, with people of your organization and groups you are in. You may also **hand it** to another member, who accepts it before it is theirs; until then you may withdraw it. A secret may have a name of your choosing, where you keep several of one kind. An administrator may delete any secret of the organization, but never share it or give it to an agent.

## When an agent is updated

An update may ask for a field a secret lacks: it is asked of you the first time the agent needs it. A field the new version no longer declares stays, and is no longer given to the agent.
