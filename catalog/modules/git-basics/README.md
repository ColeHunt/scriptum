# Git Basics

Five small git exercises, each in its own numbered folder. Every folder is
its own real git repository — look for the Source Control icon in the
sidebar and switch between them with the repository picker at the top of
that panel, or just `cd` into a folder in the terminal.

There's no GitHub account or login here. This lesson is entirely about the
`git` commands themselves. For background on why we use git the way we do,
see the team's [GitHub docs page](https://frc-team-4143.github.io/docs/software/tools/github).

## Our conventions

- **`main`** is production-ready code.
- **`develop`** is the integration branch — finished feature branches merge
  into `develop`, not `main`.
- Feature branches are named **`issue-<number>-<short-description>`**, e.g.
  `issue-12-add-turbo-boost`.
- Nobody pushes straight to `main` or `develop`.
- Commit often, with clear messages.

## The exercises

Open each folder's own `README.md` for the task. Do them in order — later
ones build on the same ideas.

1. **`01-first-commit/`** — make your first commit.
2. **`02-feature-branch/`** — branch, commit, follow the naming convention.
3. **`03-merge/`** — merge a finished feature branch into `develop`.
4. **`04-merge-conflict/`** — merge a branch that touches the same line you
   changed, and resolve the conflict.
5. **`05-rebase/`** — rebase a feature branch onto a `develop` that moved on
   without it.

## Checking your work

Click **Checkpoints** in the top bar to see the list and run **Verify**.
Each checkpoint tells you what it's looking for if it doesn't pass yet —
nothing here is graded, so verify as many times as you want.
