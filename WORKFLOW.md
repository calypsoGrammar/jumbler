---
# Archon v3 workflow for jumbler. Archon reads this file from main
# (workflow: repository:WORKFLOW.md); a change takes effect once merged, and
# Archon never auto-merges a change to it. Every key is described in
# archon-v3's docs/workflow-reference.md.
tracker:
  kind: linear
  provider:
    # Linear project "jumbler".
    project_id: "a88ddf64-d3e4-47d4-b37c-d24f7140de47"
hooks:
  # Each attempt starts from a fresh checkout; install dependencies so the
  # agent can run the tests while it works.
  before_run: |
    npm ci --no-audit --no-fund
  timeout_ms: 600000
agent:
  max_concurrent_agents: 1
archon:
  verify:
    setup:
      - npm ci --no-audit --no-fund
    commands:
      - npm test
      - npm run build
  readiness:
    # Check each ticket before the first implementation of a move to Todo, and
    # hand it back with questions when it leaves a material decision open.
    # Answer in a comment and move the issue to Todo again.
    policy: required
    profile: sonnet
    # The built-in instructions (archon-v3 src/pipeline/readiness.ts), plus the
    # owner decisions that otherwise only surface after the work is done.
    prompt: |
      You are a readiness checker for an unattended coding agent. Read the ticket before any work starts. Do not modify anything, and do not audit the repository: look at files only to understand what the ticket refers to.

      Decide whether the agent can implement this ticket and show it is done without inventing a material product, design, architecture, safety or scope decision. Ordinary, reversible engineering choices are fine: list them as assumptions instead of asking.

      Ask only when the answer would materially change the work: an ambiguous or contradictory requirement, an acceptance criterion that cannot be checked, an unclear limit, or work that belongs in another ticket. Ask the smallest concrete question, and offer options where you can.

      Treat these as owner decisions, whether or not the project has users yet. If the ticket could lead the agent to sign users out, change or drop stored data or saved files, raise the project's runtime, engine, database or service requirements, or remove a package, route, asset or feature that something might still use, and the ticket does not already say how to handle that, ask for a policy: one question per kind of change, not per case.
  implement:
    # File the implementer's suggested follow-ups and open owner decisions
    # (labelled archon:owner-decision) as related Backlog issues; Archon never
    # starts them on its own.
    file_followups: true
  review:
    profile: opus
    # File findings a passing review leaves open (below material_severity) as
    # related Backlog issues; Archon never starts them on its own.
    file_followups: true
  merge:
    # Manual, as in v2. Switch to auto once main requires the CI checks on
    # up-to-date branches and the repository allows auto-merge.
    policy: manual
  models:
    # Profiles come from the service's shared model catalogue (archon-v3
    # docs/operations.md, Models); a Model label on an issue picks another.
    default: opus
    fallback: sol
---
You are working on jumbler, Linear issue {{ issue.identifier }}: {{ issue.title }}.
{% if attempt %}
This is attempt {{ attempt }}. Earlier attempts were discarded, and this workspace is a fresh checkout.
{% endif %}

Issue description:
{{ issue.description }}

jumbler is a Vite web application. Make focused changes with tests, run `npm test` and `npm run build`, and commit your work.
