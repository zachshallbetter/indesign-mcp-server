---
description: Code style, compiler lint requirements, formatting rules, unsafe code boundaries, and concurrency safety
globs: ["**/*"]
---

# Code Style & Engineering Standards

This document defines the authoritative coding conventions, compiler lint requirements, formatting rules, and safety boundaries across projects operating under the Formal Project Bootstrap doctrine.

---

## 1. Toolchain & Workspace Standards

- **Rust Edition**: Modern stable Rust (Edition 2021 or 2024 as specified in workspace package).
- **Monorepo Crate Inheritance**:
  New crates inherit workspace package properties and lints:
  ```toml
  [package]
  edition.workspace = true
  license.workspace = true
  rust-version.workspace = true

  [lints]
  workspace = true
  ```

---

## 2. Formatting Standards (`rustfmt.toml`)

All Rust code must adhere to the ecosystem formatting configuration:

```toml
max_width = 150
use_small_heuristics = "Max"
```

- **Imports**: Group imports cleanly: standard library (`std::`), external crates, internal workspace crates, and local module items (`super::`, `self::`).
- **Trailing Commas**: Prefer trailing commas in multiline struct definitions, enum variants, and function arguments to minimize git diff churn.

---

## 3. Strict Quality Lints & Never-Crash Policy

Every crate root (`src/lib.rs` or `src/main.rs`) must explicitly enforce the Never-Crash compiler lints:

```rust
#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::unimplemented,
    clippy::todo,
    clippy::unreachable
)]
```

### Compiler Warning Zero-Tolerance
In CI and pre-commit checks, compiler warnings are treated as build errors:
```bash
cargo clippy --workspace --all-targets -- -D warnings
```

### Test Scope Exceptions
Unit and integration tests are allowed to use indexing and unwrapping for brevity, configured in `clippy.toml`:
```toml
allow-unwrap-in-tests = true
allow-expect-in-tests = true
allow-panic-in-tests = true
allow-indexing-slicing-in-tests = true
```

---

## 4. Unsafe Code Boundary

- **Unsafe Code Forbidden**:
  Across shared libraries and high-level applications, unsafe code is strictly forbidden by default:
  ```rust
  #![forbid(unsafe_code)]
  ```
- **Isolated Hardware / Low-Level FFI Exceptions**:
  Where physical hardware interaction, memory mapping, or native platform APIs require unsafe code, it must be:
  1. Isolated in a dedicated low-level foundation crate.
  2. Gated behind crate-wide `#![deny(unsafe_code)]` with per-block unsafe scopes.
  3. Documented with explicit `// SAFETY:` rationale explaining pointer provenance, thread affinity, and lifetime guarantees.
  4. Unit-tested against edge conditions and boundary violations.

---

## 5. Concurrency & Resource Safety

- **Graceful Lock Poisoning Handling**:
  Never panic when acquiring mutexes or rwlocks. Recover from poisoned locks gracefully:
  ```rust
  let mut guard = mutex.lock().unwrap_or_else(PoisonError::into_inner);
  ```
- **Bounded Resource Allocations**:
  Real-time or latency-sensitive paths must never block indefinitely or allocate unbounded memory sized by foreign input.
