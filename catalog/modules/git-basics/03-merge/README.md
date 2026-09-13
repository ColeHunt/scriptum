# 3. Merge

This repo already has a finished feature branch, `issue-7-auto-distance`,
branched off `develop`. It adds `AUTO_DISTANCE_METERS` to `Constants.java`.
Take a look with `git log issue-7-auto-distance` if you want to see its
commits.

## Task

Merge `issue-7-auto-distance` into `develop` — the feature is done, it's
time to bring it in.

```
git checkout develop
git merge issue-7-auto-distance
```

Don't touch `main`. Run **Verify** when you're done.
