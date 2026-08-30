# Issue tracker: GitHub Issues via `gh` CLI

Issues and specifications are tracked on GitHub Issues in the fork repository (`dahagag/odoo`, the `origin` remote — not `odoo/odoo`, the `upstream` remote) using the `gh` CLI.

## Conventions

- Issues are created and managed via `gh issue` commands
- Use descriptive titles and include context in the issue body
- Link related issues and PRs using GitHub's reference syntax (`#123`)
- Use labels for categorization (e.g., `needs-triage`, `ready-for-agent`, `ready-for-human`, `wontfix`)
- Reference issue numbers in commit messages and PR descriptions

## Common commands

```bash
# Create a new issue
gh issue create --title "Title" --body "Description" --label "label1,label2"

# List issues
gh issue list

# View a specific issue
gh issue view <number>

# Add labels to an issue
gh issue edit <number> --add-label "label"

# Close an issue
gh issue close <number>

# Link a PR to an issue
# In the PR description, use: Fixes #123 or Relates to #123
```

## When creating a new issue

```bash
gh issue create \
  --title "Clear title" \
  --body "Detailed description with context" \
  --label "needs-triage"
```

## When working on an issue

1. Reference the issue in your branch name or commit messages (e.g., `#123: description`)
2. When creating a PR, reference the issue with `Fixes #123` or `Relates to #123`
3. GitHub will automatically link the PR to the issue
