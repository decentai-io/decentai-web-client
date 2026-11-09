# Administration

Who exists, and what each of them may do. It is reached from the menu on your name, where **Admin console** shows **Account** with your **Profile**, and **IAM** — the **Organization**, Users, Groups and Policies — to those who may manage them; **Main workspace** in the same menu goes back.

## Organizations

An organization keeps everything of its own apart from every other: its people, groups and policies, the agents it installed, its records, chats and settings. It begins at first run, with the setup code; by sign-up, where the deployment allows it; or by the deployment's operator.

Every organization has two groups from the start. **Everyone** holds every person without listing them, and gives them the built-in **Member** policy: what every person needs — their own chats, records and settings, the agents they may use, their API keys. **Administrators** holds the built-in **Administrator** policy, which allows every action. The built-in policies are the platform's, and change with every upgrade.

## People

Invite a person by email on **Admin console → IAM → Users**; the invitation lasts seven days and lets them choose their name and password. Invitations not yet accepted are listed, to withdraw. Where the deployment sends no email, you add a person instead, and are shown a temporary password to hand over; they replace it at their first sign-in. **Reset password** mails a link, or, without email, makes another temporary password.

A person's access is the groups they are in, and the policies those groups hold.

**Disabling** a person signs them out at once, and keeps everything of theirs. **Stop everything** stops every chat and schedule of theirs until it is resumed.

**Removing** a person: their sessions, keys, chats, schedules and memories go. What they shared with others passes to a successor you choose, so its users keep it; of what they kept to themselves, data and files pass to the successor, and secrets are deleted — a person's passwords and accounts are theirs alone. Their lines stay on the audit trail. The dialog says first what it will touch.

Three rules hold for every change to people, groups and policies: you grant only what you hold yourself; you change only someone who holds no more than you do; and an organization always keeps someone who can manage access.

## Operating

The platform is an API server, runtimes, the sandboxes agents run in, and this web app, over a database. The deployment's own documentation covers starting it, its settings, and the admin tool its operator runs inside the API server's container: organizations, resetting a password, keys and storage.

Email — invitations, password resets, sign-up, and notifications — needs the deployment's mail server set up; without it nothing is mailed. Notifications in browsers need its web push keys.

Next: [Groups and policies](/guide/access), how what a person may do is decided.
