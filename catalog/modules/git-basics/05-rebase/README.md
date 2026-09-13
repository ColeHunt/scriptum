# 5. Rebase

`issue-15-led-colors` branched off `develop` a while back and adds a
`RAINBOW` color. Since then, `develop` picked up an unrelated commit. Your
branch is now behind.

## Task

Rebase your branch onto the latest `develop`, instead of merging:

```
git checkout issue-15-led-colors
git rebase develop
```

If there's nothing to resolve, this just replays your commit on top of the
new `develop`. (This scenario is set up so it rebases cleanly — no conflict
to resolve here, that was exercise 4.)

Don't touch `develop`. Run **Verify** when you're done.
