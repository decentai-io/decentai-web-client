# Agents and the marketplace

An agent is a program the assistant can call: a manifest that declares exactly what it does, what it keeps and where it connects, and a program that does only that. Nothing ships installed. An organization installs what it needs from catalogs it trusts.

## Where agents come from

A **source** is the address of a catalog: one JSON document listing the agents on offer, each with its manifest, the program for each machine it runs on — named by its size and digest — and, where it has them, sample data and a README. The API server reads the catalog without running anything, and keeps it as it read it.

Administrators save sources on **Agents → Marketplace**. A source may need a credential — a token, or a header and its value — which is kept encrypted, sent only to the source's own host, and never shown again; changing a source's address asks for it again. **Refresh** reads a source again. Deleting a source uninstalls the agents installed from it.

## Installing

Installing is an administrator's **review** of one exact version. The review shows what the agent declares — its functions and their levels, what it may call, the records it keeps, where it connects — and what would be downloaded: the program for each machine, and the base it needs. An entry with something wrong with it says what, and cannot be installed.

The install is pinned to the catalog as it was reviewed: if the source was read again since and changed, the install is refused and the review shown again. Each file is downloaded, checked against its digest and size, and kept; from then on the publisher's server is never needed.

A runtime then starts the agent once, with no network, and checks that it answers as its manifest says. Until then the agent is *checking* and nobody can use it; if the check fails, its page says why, and an administrator can ask for it again.

**A version never changes.** The same version with other bytes is refused, even after an uninstall. An update is a new version: the marketplace says *Update available*, and installing it is the same review. The agent keeps its records and its permissions. An agent id comes from one source only: another source offering the same id is shown as from another source, and cannot be installed over it.

## Who may use it

Using an agent is a permission like any other. Your organization's policies name agents' functions — `agent:notebook:save`, or `agent:notebook:*` for all of them — and a person may use an agent when a policy of theirs allows one of its functions. A policy may also say a function always **asks**, or narrow it to the values its manifest's scopes allow, such as certain notebooks. *Groups and policies* has the rules.

A chat uses the agents its settings choose among those its person may use.

## What an agent keeps

An agent declares the records it keeps for people: secrets to sign in with, data it keeps, files. Each record lists the agents that may use it; an agent never reaches one that does not list it. *Secrets* and *Records and files* have the rest.

## Sample data

An agent may ship **samples**: records and files to try it with before you have any of your own. Its page says what they hold, loads them as your own records, and removes exactly what was loaded in one step.

## Uninstalling

Uninstalled, an agent runs no more. Its records stay their people's, and installing it again gives them back to it.

## The reference catalog

Where the deployment names one, the marketplace suggests the project's own catalog: general-purpose agents for the accounts you already work in, the files you hand over, the public web, and what you keep. Each has a README describing what it does and what it needs.
