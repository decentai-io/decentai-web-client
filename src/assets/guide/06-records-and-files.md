# Records and files

Agents keep things between conversations: a task with its owner and due date, an invoice with its lines, a filled document. These appear under **Data → Records** and **Data → Files**, where you find, read, share and delete them whether or not the agent is still installed.

## Kinds and shapes

Every record is of a **resource** an agent declared in its manifest: the Tasks agent keeps *tasks*, the Invoicing agent *invoices* and *payments*. A resource has fields — their types, which are plain and which encrypted — and every write, the agent's or yours, is checked against them. That is what lets an agent read back what you wrote by hand.

Records are listed by agent and resource. Open one to see its fields by their labels.

## Writing records yourself

Where the agent's manifest allows it, you add a record of its resource with a form made from its fields, and change one. An agent that did not allow it keeps that resource to itself: reading and deleting are always yours.

## Which agents may use one

A record lists the agents that may use it, each with the resource it serves; at first, the agent that made it. You may add another agent by hand, choosing which of its resources the record serves, when the kinds match and the record has every field that resource requires. An agent never reaches a record that does not list it.

## Sharing and handing on

A record is private to you until you share it, with people of your organization and groups you are in. Sharing a record also lets those people's chats use it, through the agents it lists. You may **hand a record** to another member: it waits on their page until they accept it.

## Files

**Data → Files** holds what you uploaded — on the page, or attached in a chat — and what agents made: a filled document, a statement, a workbook. A file's type is checked from its bytes when it arrives, and a download is always a file to save; a picture or a PDF can be shown. A file can be renamed, shared, handed on, listed for an agent's file resource, and deleted, as a record can.

Your own file reaches an agent only by being handed to a call, in a chat, where you see it.

## Skills

**Data → Skills** holds short instructions written for the assistant: how to write a customer quotation, how meeting notes are laid out. The assistant sees each skill's name and description in the chats that use it, and reads one whole when the task calls for it — so the description says when it applies.

A skill is yours until you share it. You may hand one to another member, who accepts it. The assistant may also offer to save a skill from a chat, on a card: it is saved only if you say so.
