# Groups and policies

What a person may do is never written on the person. It comes from the groups they are in, and the policies those groups hold. This chapter is that chain, how a policy is written, and how sharing sits beside it.

## The model

```
person → groups (Everyone included) → policies → statements
```

A **policy** is a list of statements. A **group** holds policies. A person is in groups, and always in Everyone. Nothing is copied into a session: a change takes effect on the person's next call.

A statement is an effect and the actions it covers:

```
{"effect": "allow", "actions": ["ai:chat:*", "agent:notebook:*"]}
```

- **An action is an endpoint** — `ai:chat:list`, `data:record:create`, `agents:agent:install` — or what an agent does: one of its functions, `agent:<agent>:<function>`, or something that function calls, `agent:<agent>:<function>:record.read:logins`. A `*` covers many.
- **A deny wins, then an ask, then an allow.** Nothing matching is a deny.
- **Ask and scopes are for agents' actions only.** An ask puts the question to the chat's person on a card, who may remember the answer. Scopes narrow a function to the values its manifest allows: `{"effect": "allow", "actions": ["agent:notebook:save"], "scopes": {"notebook": ["work"]}}`.
- **After the policy,** a function above the chat's trust level still asks.

## Groups and policies

On **Admin console → IAM → Policies**, write a policy naming actions; on **Groups**, give a group its policies; on **Users**, place people in groups. The built-in **Administrator** and **Member** policies can't be changed; write your own to grant more, or to deny.

Using an agent is a policy like any other: a person may use an agent when a policy of theirs allows, or asks for, one of its functions.

Actions worth knowing when writing a policy:

| Action | Grants |
|---|---|
| `agents:agent:install`, `agents:agent:sourcecreate` … | Saving sources, and installing, updating and uninstalling agents |
| `agent:<agent>:*` | Using an agent |
| `ai:audit:list_all` | Reading the organization's whole audit trail |
| `agents:monitor:*` | Seeing what agents and models used, on **Organization → Monitoring** |
| `settings:organization:*`, `settings:llm:*`, `settings:oauth:*` | The organization's settings, model connections and connected apps |
| `nodes:node:*`, `nodes:authority:*` | The runtimes and sandboxes, and the tokens that enroll them |
| `iam:*` | People, groups, policies and invitations |

## Sharing

Records, skills, MCP servers and webhooks follow one rule: yours until you share them, with people of your organization and groups you are in — Everyone is the whole organization. Seeing something is never authority over it: only its owner changes it. Its owner may **hand it** to another member, who accepts it before it is theirs, with its sharing untouched; until then, the owner may **withdraw** the hand-over.
