---
description: Type system architecture, non-panicking returns, safe arithmetic, and hostile input handling
globs: ["**/*"]
---

# Type System Architecture & Domain Invariants

This document defines the core type invariants, numerical representations, and error handling contracts across projects operating under the Formal Project Bootstrap doctrine.

---

## 1. Non-Panicking Return Types

Library and production code must completely eliminate implicit panics by modeling all fallibility through explicit Rust type signatures.

- **Explicit `Result<T, E>` & `Option<T>`**:
  Every operation that can encounter missing data, malformed inputs, full disks, or unsupported features must return an explicit `Result` or `Option`.
- **Domain-Specific Error Enums**:
  Each crate defines its own rich error enum using `thiserror`. Never use generic string errors (`Result<T, String>`) or boxed trait objects (`Result<T, Box<dyn Error>>`) in public crate APIs.
- **Unsupported Feature Representation**:
  Unfinished features or missing format chunks must return an explicit `Err(Error::Unsupported(...))` variant rather than calling `todo!()` or `unimplemented!()`.
- **Never Unwrap**:
  No `.unwrap()`, `.expect()`, or `panic!()`. Use `ok_or(..)?`, `let ... else { return Err(...); }`, or `unwrap_or_default()` / `unwrap_or_else()` where a safe, non-corrupting fallback is logically guaranteed.

---

## 2. Hostile Numerical Types & Safe Arithmetic

All numerical data received from files, foreign protocols, IPC sockets, or user parameters must be treated as hostile:

- **Safe Slicing & Indexing**:
  - Direct indexing (`v[i]`, `s[a..b]`) is strictly forbidden on input-derived numbers.
  - Always use `.get(index)` or `.get(range)` and handle `None`.
  - Slicing strings requires explicit character boundary validation:
    ```rust
    if s.is_char_boundary(idx) {
        let prefix = &s[..idx];
    }
    ```
- **Checked & Saturating Arithmetic**:
  - Byte lengths, offsets, coordinate grids, and buffer capacities must use `checked_*` or `saturating_*` arithmetic methods to prevent integer overflows.
  - Guard against division by zero before executing modular arithmetic or scaling ratios.
- **Floating-Point Verification**:
  - Float values for dimensions, coordinates, scale factors, and layout bounds must be verified as finite (`f.is_finite()`).
  - Reject or clamp `NaN`, `+inf`, and `-inf` before converting floats to integers (`as usize` / `as u32`).

---

## 3. Geometric & Spatial Primitives

Coordinate spaces across 2D/3D systems must distinguish screen space, canvas space, and world space:

- **Subpixel Coordinate Types**:
  - Use strongly typed coordinate math (`glam`, `kurbo`, or `euclid`).
  - Maintain clear separation between physical device pixels, logical layout points, and normalized texture UV coordinates.
- **Non-Invertible Transformations**:
  - Affine transformation matrices must check for invertibility before calculating inverse projections (e.g. pointer click to 3D world ray).
- **Bounding Boxes**:
  - Bounding boxes (`Rect` or `Aabb`) must remain normalized (`min <= max`). Invalid or inverted bounding volumes must never be passed to spatial query acceleration trees.
