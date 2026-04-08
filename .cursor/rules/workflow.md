# Workflow Rules

Default workflow for non-trivial tasks:
1. Scope the request.
2. Produce a plan.
3. Implement the approved plan.
4. Review the diff.
5. Verify with tests, lint, and type checks.
6. Only then do optional polish/refactor.

Do not skip verification.
Do not claim a task is done unless verification has passed or failures are explicitly reported.
Run tasks in sequential order, never in parallel