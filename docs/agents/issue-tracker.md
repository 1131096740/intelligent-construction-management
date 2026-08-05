# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues at `1131096740/intelligent-construction-management`. Use the `gh` CLI from this repository so it resolves the remote automatically.

## Conventions

- Create: `gh issue create --title "..." --body "..."`.
- Read: `gh issue view <number> --comments` and include labels when filtering.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
- Comment: `gh issue comment <number> --body "..."`.
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

Pull requests are not part of the issue triage queue. GitHub Issues hold product requests and implementation tickets; pull requests deliver already scoped work.

## Skill operations

- When a flow says “publish to the issue tracker”, create a GitHub Issue.
- When a flow says “fetch the relevant ticket”, run `gh issue view <number> --comments`.
- Tickets generated from an accepted spec are already agent-ready and must not be triaged again.
- Multi-ticket work records `Blocked by: #<number>` and `Part of #<number>` until native dependency links are available.
- A ticket is ready only when all blockers are closed. Claim it before implementation and close it with the final SHA and verification receipt.
