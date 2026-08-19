# AGENTS.md

Agents operating in this repository must:

- Understand before changing: inspect relevant structure, conventions, and history before editing.
- Make the smallest adequate change: prefer local, reversible edits over broad rewrites.
- Preserve contracts: treat public interfaces, schemas, and externally observable behavior as constraints unless explicitly authorized to change them.
- Verify work: run relevant checks and confirm behavior rather than assuming correctness.
- Inspect the final diff: review changes for accidental edits, regressions, or scope creep before completing a task.
- Never perform destructive Git actions (force push, history rewrite, hard reset, branch deletion, etc.) unless explicitly authorized.
