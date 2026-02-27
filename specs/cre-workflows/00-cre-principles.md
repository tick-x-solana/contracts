# CRE Principles and Guardrails

These rules apply to all 5 workflows.

## 1) CRE Execution Model

- Workflows run as `trigger -> callback`.
- A trigger callback is stateless and should not rely on in-memory state from previous runs.
- Every trigger event is processed independently.
- Capabilities are asynchronous and can run in parallel.

## 2) Determinism Rules

- Keep callback logic deterministic.
- Do not use randomness, wall-clock branching, non-deterministic map iteration, or race-based branching for business decisions.
- Sort collections before hashing/encoding.
- Build canonical payload encodings for report generation.

## 3) Consensus Computing

- CRE runs workflow computation with decentralized consensus.
- Any logic that affects report payloads must be deterministic and reproducible.

## 4) Finality / Confidence

- For financial state transitions, use strong confirmation/finality settings.
- EVM log triggers should use configured confidence levels aligned with risk:
  - settlement/distribution: finalized
  - non-critical monitoring: safe/confirmed can be considered
- Onchain reads used for idempotency checks should read finalized state.

## 5) Onchain Writes

- Follow CRE report flow for writes:
  - build report in workflow
  - submit report onchain
  - consumer/receiver contract processes the report
- Keep write payloads compact and versioned.
- Include idempotency keys (epoch/window/batch identifiers) in report payloads.

## 6) Quotas and Runtime Limits

- Workflow execution timeout target: stay comfortably below CRE limits.
- Trigger frequencies must respect CRE quotas.
- Cron jobs in this project are valid under documented minimum cadence constraints.

## 7) Security and Operations

- Store secrets via CRE secret management, never hardcode.
- Simulate workflows before deployment.
- Use CRE monitoring and tx status tracking for production-like observability in hackathon demo.

## References

- [CRE Overview](https://docs.chain.link/cre)
- [Triggers and Callback Model](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/trigger-and-callback)
- [Stateless Workflows](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/triggers/write-stateful-workflows)
- [Avoid Non-Determinism](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/concepts/non-determinism-in-workflows)
- [Finality and Confidence Levels](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/concepts/finality-confidence-levels)
- [Onchain Report Submission](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/onchain-write/evm/submit-reports-onchain)
- [Service Quotas](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/cre-service-quotas)
- [Monitoring and Debugging](https://docs.chain.link/cre/reference/sdk/workflow/development-guides/deployments/monitoring-debugging-workflows)
