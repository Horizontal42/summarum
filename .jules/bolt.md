## 2025-02-18 - Repeated Regex Execution Caching
 **Learning:** In recursive or looping traversal like graph cycle detection (e.g. invalidation of multiple sheets), running heavy Regex (`matchAll`) repeatedly on the exact same text is extremely slow and compounds exponentially.
 **Action:** Introduce text-based short-circuiting caches (e.g., matching the original `text` property against the cached payload string) where text extraction logic like Regex or parsing runs purely on deterministic inputs.
