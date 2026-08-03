# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues at
`1131096740/intelligent-construction-management`. Use the `gh` CLI from this
repository so it resolves the remote automatically.

## Conventions

- Create: `gh issue create --title "..." --body "..."`.
- Read: `gh issue view <number> --comments` and include labels when filtering.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.** Pull requests are not part of the issue triage
queue. This flag may be changed here later if the repository starts accepting
external PRs as feature requests.

## Skill operations

- When a skill says "publish to the issue tracker", create a GitHub issue.
- When a skill says "fetch the relevant ticket", run
  `gh issue view <number> --comments`.
- GitHub issues and pull requests share a number space. If a bare number is
  ambiguous, try `gh pr view <number>` and fall back to `gh issue view <number>`.

## Wayfinding operations

`wayfinder` uses one issue labelled `wayfinder:map` as the map and linked child
issues as tickets. Child tickets use `wayfinder:<type>` labels, where the type is
`research`, `prototype`, `grilling`, or `task`.

Use GitHub sub-issues and native issue dependencies when available. Otherwise,
link children from the map task list and put `Part of #<map>` and
`Blocked by: #<number>` lines in child issues. A ticket is ready only when all
blockers are closed and it is unassigned. Claim it with
`gh issue edit <number> --add-assignee @me`; resolve it with a final comment and
then close it.
