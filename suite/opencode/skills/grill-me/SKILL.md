---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each dependency in the decision tree one question at a time. Use when the user says "grill me", "interview me", "stress-test this plan", "challenge my plan", or before finalizing a substantive plan.
license: MIT
metadata:
  source: https://github.com/mattpocock/skills (grill-me)
---

# Grill me

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for the answer before asking the next. If a question can be answered by exploring the codebase, explore the codebase instead.

## Rules

- Facts belong to the agent: inspect code, tests, configuration and history before asking.
- Decisions belong to the user: ask about goals, scope, constraints, trade-offs and acceptance criteria.
- Do not accept vague or contradictory answers; resolve them or record the open assumption explicitly.
- Push back when the plan has holes; do not act as a yes-man.
- Stop when the next concrete action is unambiguous, then summarize the resolved decisions and assumptions.
- This skill is stateless: do not write plan files or leave artifacts unless the active agent's own contract allows it.
