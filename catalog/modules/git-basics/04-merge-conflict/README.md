# 4. Merge Conflict

`develop` and a feature branch, `issue-9-max-speed`, both changed
`MAX_SPEED` in `Constants.java` — to different values. Merging is going to
conflict.

## Task

1. Merge the feature branch into `develop`:
   ```
   git checkout develop
   git merge issue-9-max-speed
   ```
2. Git will stop and mark the conflict in `Constants.java`. Open the file —
   VSCodium shows the two versions with **Accept Current**, **Accept
   Incoming**, and **Accept Both** buttons right above the conflict. Pick
   one value for `MAX_SPEED` (either is fine) and remove the
   `<<<<<<<`/`=======`/`>>>>>>>` markers.
3. Stage the resolved file and finish the merge:
   ```
   git add Constants.java
   git commit
   ```
   (A commit with no `-m` opens the editor with a pre-filled merge message —
   just save and close it.)

Run **Verify** when you're done.
