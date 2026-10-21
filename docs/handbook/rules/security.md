# Security & Authorization Policy

## 1. Tool Capability vs Authority

Tool availability is capability, not permission. Before mutation, verify:
- target resource identity;
- current revision and working tree state;
- authorized effect class;
- rollback and recovery path when required.

## 2. Credential Containment

- Never request, disclose, reproduce, transfer, or substitute API credentials, tokens, or private secrets as a replacement for authorization.
- Never compile `.env`, `.env.local`, or secret tokens into context manifests (`llms.txt`), records, or evidence logs.

## 3. External Authorization Fail-Closed Policy

- When external authorization (ACP) is configured, governed effects fail closed if authorization cannot be verified.
- `ALLOW` permits only the exact authorized action, ref, and SHA pair within capability TTL.
- Never attempt to bypass authorization through conversational shortcuts or alternate tooling.
