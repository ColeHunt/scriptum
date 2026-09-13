# 2. Feature Branch

This repo has `main` and `develop`, both pointing at the same starting
commit. There's an imaginary issue #12: "Add a turbo boost feature."

## Task

1. Create a branch off `develop` named `issue-12-<short-description>`
   (e.g. `issue-12-turbo-boost`) — the number has to be 12, the words after
   it are up to you.
   ```
   git checkout develop
   git checkout -b issue-12-turbo-boost
   ```
2. Add at least two lines to `FEATURES.md` describing the feature.
3. Make **at least two separate commits** on your branch (not one commit
   with everything in it).
4. Leave `main` and `develop` alone — don't commit directly to either.

Run **Verify** from the Checkpoints panel when you're done.
