## 2024-07-08 - Use DocumentFragment to batch DOM inserts
 **Learning:** Batching DOM insertions using DocumentFragment reduces repaints and layout recalculations. While the exact performance impact relies on environment details (e.g. vitest+jsdom drops time by ~25%), it's a standard and safe optimization for large loops.
 **Action:** Apply DocumentFragment before loops that append many elements to a live DOM container.
