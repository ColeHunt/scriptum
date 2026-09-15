---
sidebar_position: 1
title: Privacy Policy
---

# Privacy Policy

**Last updated: August 12, 2026**

CodeRunner is a self-hosted, browser-based IDE for teaching FRC robot programming. This
policy explains what personal information CodeRunner handles, why, and what is done with it.

## Who this policy covers

CodeRunner is open-source software that schools and robotics teams install and run on their
own hardware. Each installation is operated independently.

- **For the instance you use.** The organization that runs your instance — your school,
  robotics team, or mentor — decides who may sign in, controls the server, and is
  responsible for the data on it. Sign-in is delegated to Legion, that organization's own
  member-management service; CodeRunner never collects a password or contacts a
  third-party identity provider itself.
- **For the CodeRunner project.** The project maintainers publish the software and this
  documentation. They do not operate your instance, cannot see your data, and receive no
  data from installations.

This policy describes how the software behaves. An operator may publish additional terms of
their own.

## What information is collected

**Account information from sign-in.** CodeRunner delegates sign-in to Legion, the
operator's own team-roster and single-sign-on service (also run on the operator's own
server — not a CodeRunner-operated service). Legion authenticates you over Slack and hands
CodeRunner a signed token containing:

- a stable member identifier (not tied to any external account)
- your username, as assigned by Legion
- your display name
- your role (student or mentor) and, if applicable, your team number
- the authorization groups Legion has granted you, which determine whether you can reach
  CodeRunner's admin panel

CodeRunner does not receive an email address, a password, or a profile picture — Legion
doesn't provide one. This information refreshes from Legion each time you sign in; nothing
is requested from or shared with Google, GitHub, or any other third-party identity
provider.

**Work you create.** The Java code, project files, and lesson progress in your workspace are
stored on the operator's server.

**Operational records.** The server keeps a log of administrative actions (recording the
acting user's ID and username, the action, and its target) and standard application logs.
Sign-in sessions themselves are not stored by CodeRunner — each request is re-verified
against Legion's signed token directly.

## How the information is used

Your account information is used only to run the service:

- to identify you across requests and keep you signed in
- to derive your workspace name and provision your personal container
- to display your name in the interface
- to determine whether you can reach the administrator panel, based on the groups Legion
  reports for your account
- to let administrators of that instance see who has an account and what administrative
  actions were taken

## What is not done with it

- It is **never sold, rented, or traded**.
- It is **not used for advertising** or ad targeting, and not shared with data brokers.
- There are **no third-party analytics or tracking services** in the application.
- It is **not shared** with anyone outside the operator of your instance, except where the
  operator is legally required to disclose it.
- It is **not used to train machine learning or AI models**.

## Where information is stored

Everything stays on servers your operator runs. Account records and audit entries live in a
SQLite database on the CodeRunner machine; your code lives in a directory on the same
machine; your Legion identity and group membership live on the operator's Legion instance.
Nothing is sent to a CodeRunner-operated service, because there isn't one.

Your operator is responsible for securing that server, and for any backups they choose to
make.

## How long it is kept

A Legion sign-in is trusted for up to the session length the operator's Legion instance
configures (typically 12 hours), and refreshes as you use the app. Account records,
workspace contents, and audit entries persist until an administrator deletes them or removes
the instance.

Note that some ordinary actions **intentionally discard** your workspace contents: switching
or resetting a lesson module, or importing a repository, replaces what was there. Use Git for
work you need to keep. See the [Terms of Service](./terms.md).

## Your choices

- **Stop sharing.** Sign-in access is controlled through Legion. Ask your operator to remove
  your Legion account or its authorization groups to prevent future sign-ins.
- **Access or delete your data.** Contact your instance's administrator. They can delete your
  account and workspace from the server.

## Children's privacy

CodeRunner is built for FRC teams, so many users are minors. It is deployed by schools and
robotics programs, and students use it under the supervision of that program. Sign-in
accounts are managed entirely by that program through Legion, its own roster system — there
is no external account creation step. If you are a parent or guardian with questions about a
particular instance, contact the operating school or team.

## Changes to this policy

Material changes will be reflected here with an updated date above. The revision history is
public in the
[project repository](https://github.com/mathewdunne/CodeRunner/commits/main/docs/legal/privacy.md).

## Contact

For questions about the CodeRunner software or this policy, open an issue at
[github.com/mathewdunne/CodeRunner/issues](https://github.com/mathewdunne/CodeRunner/issues).

For questions about a specific installation and the data on it, contact the school, team, or
mentor who operates it.
