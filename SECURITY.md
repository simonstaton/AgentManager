# Security

## Reporting vulnerabilities

Report security vulnerabilities to **simon.staton@live.co.uk**. Do not open public issues for security vulnerabilities.

## Note on agent execution

This project runs Claude CLI with `--dangerously-skip-permissions`. Agents can execute arbitrary commands within their isolated workspace. Each agent runs in an ephemeral directory with no network access to databases or internal systems, and is sandboxed by design.
