/** A made-up log for the "Try an example" button. Not from a real project. */
export const EXAMPLE_LOG = `a91c3f2 Merge pull request #212 from mira/csv-export
7d02e1b feat(reports): export reports as CSV (#212)
c4e88a0 fix: crash when uploading files larger than 10mb
19bf7d4 perf(dashboard): batch user queries on dashboard load (#208)
e2a6c51 chore(deps): bump eslint from 9.12.0 to 9.13.0
5f1d9aa fix(ui): dark mode toggle not persisting after refresh
0b7e3c9 wip
88c2d17 feat(teams): allow admins to invite teammates by link (#205)
3e9a0f6 refactor: extract upload validation into its own module
d4410b8 fix: resolve race condition in websocket reconnect
61aa2e0 perf(gallery): lazy load images
b2c7f19 docs: explain the new invite flow in the README
9fe0d35 v2.3.0`;

export const GIT_COMMAND =
  "git log --oneline $(git describe --tags --abbrev=0)..HEAD";
