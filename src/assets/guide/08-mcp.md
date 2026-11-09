# Tools (MCP servers)

An MCP server is a service on the internet that offers **tools** the assistant can call: search a wiki, look up a ticket, update a tracker. Many products publish one. You add a server once, under **Data → Tools**, and the chats that use it can call the tools you switch on.

It is not an agent. An agent is a program the platform runs after an administrator reviewed it. An MCP tool runs on its own server: a runtime sends it a request and reads the answer.

## Adding a server

Press **Add a server** and give:

- **A name** — what you and the assistant will call it.
- **Its address** — a public address; one inside your own network is refused.
- **A credential**, if the server wants one: a token, sent as a bearer token, or a header the server names and its value. It is kept encrypted, sent only to that server, and never shown again. A new address needs it again.

Once it is added, a runtime reads the tools the server offers. Your organization may not allow MCP servers: then none can be added, and the page says so.

## Looking its tools over

Open a server to see its tools, each with what the server says it does, and a switch: a tool that is off is called by no chat. **All on** and **All off** set every tool at once. Every tool starts off, and so does a tool the server offers for the first time when it is read again.

**Read again** asks a runtime to read the server's tools afresh.

## In a chat

A chat's settings choose which of your servers it uses; none chosen is all of them. The assistant uses a tool when it fits what you asked.

## Sharing and handing on

A server is yours until you share it, with people of your organization and groups you are in: their chats can then call the tools you switched on, with the credential you gave it, which they never see. Only you change it. You may hand a server to another member, who accepts it before it is theirs.

## Removing one

**Remove** asks first, then deletes the server and its credential: chats can no longer call its tools.
