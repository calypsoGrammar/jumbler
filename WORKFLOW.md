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
    default: sol
    fallback: opus
    profiles:
      sol:
        adapter: codex
        model: gpt-5.6-sol
        reasoning: medium
        linear_label: Sol
      opus:
        adapter: claude-code
        model: claude-opus-5-5
        linear_label: Claude Opus 5.5
---
You are working on jumbler, Linear issue {{ issue.identifier }}: {{ issue.title }}.
{% if attempt %}
This is attempt {{ attempt }}. Earlier attempts were discarded, and this workspace is a fresh checkout.
{% endif %}

Issue description:
{{ issue.description }}

jumbler is a Vite web application. Make focused changes with tests, run `npm test` and `npm run build`, and commit your work.
