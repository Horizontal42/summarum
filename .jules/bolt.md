## 2024-05-19 - N+1 Query in Historical Rates Fetching

**Learning:** Sequential async fetching loops (`for (const item of items) { await fetch(item) }`) can cause massive latency on independent queries (e.g., fetching exchange rates for different dates) and are trivially parallelized using `Promise.all`. The performance impact in benchmarks showed a drop from ~300ms down to ~10ms for just 30 requests.
**Action:** Always scan for `await` inside loops, and if the data flow permits independence, hoist the loop into an array of concurrent promises. Use `filter` and `map` before `Promise.all` to prepare the workload and process successful responses sequentially afterwards.
