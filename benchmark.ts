class MockClassList {
  classes: Set<string> = new Set();
  add(cls: string) { this.classes.add(cls); }
  remove(cls: string) { this.classes.delete(cls); }
}

class MockHTMLElement {
  classList = new MockClassList();
  dataset: any = {};
}

const N = 10000;
const ITEM_COUNT = 100;

function benchmarkOld() {
  const cachedItems = Array.from({ length: ITEM_COUNT }, (_, i) => ({
    el: new MockHTMLElement(),
    top: i * 10,
    bottom: i * 10 + 9
  }));
  cachedItems.forEach((item, i) => item.el.dataset.docId = String(i));

  const data = { docs: Array.from({ length: ITEM_COUNT }, (_, i) => ({ id: String(i), pinned: false })) };
  const doc = { pinned: false };
  const el = cachedItems[0].el;

  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const clientY = (i % ITEM_COUNT) * 10 + 5; // simulate moving through all items

    let over: MockHTMLElement | undefined;
    for (const item of cachedItems) {
      item.el.classList.remove("drag-over");
      if (!over && item.el !== el) {
        if (clientY >= item.top && clientY <= item.bottom) {
          over = item.el;
        }
      }
    }
    if (over) {
      const overDoc = data.docs.find((d) => d.id === over.dataset.docId);
      if (overDoc && !!overDoc.pinned === !!doc.pinned) over.classList.add("drag-over");
    }
  }
  return performance.now() - start;
}

function benchmarkNew() {
  const cachedItems = Array.from({ length: ITEM_COUNT }, (_, i) => ({
    el: new MockHTMLElement(),
    top: i * 10,
    bottom: i * 10 + 9
  }));
  cachedItems.forEach((item, i) => item.el.dataset.docId = String(i));

  const data = { docs: Array.from({ length: ITEM_COUNT }, (_, i) => ({ id: String(i), pinned: false })) };
  const doc = { pinned: false };
  const el = cachedItems[0].el;
  let prevOver: MockHTMLElement | undefined;

  const start = performance.now();
  for (let i = 0; i < N; i++) {
    const clientY = (i % ITEM_COUNT) * 10 + 5; // simulate moving through all items

    let over: MockHTMLElement | undefined;
    for (const item of cachedItems) {
      if (!over && item.el !== el) {
        if (clientY >= item.top && clientY <= item.bottom) {
          over = item.el;
        }
      }
    }

    let newOver: MockHTMLElement | undefined;
    if (over) {
      const overDoc = data.docs.find((d) => d.id === over.dataset.docId);
      if (overDoc && !!overDoc.pinned === !!doc.pinned) {
        newOver = over;
      }
    }

    if (prevOver && prevOver !== newOver) {
      prevOver.classList.remove("drag-over");
    }
    if (newOver && prevOver !== newOver) {
      newOver.classList.add("drag-over");
    }
    prevOver = newOver;
  }
  return performance.now() - start;
}

const oldTime = benchmarkOld();
const newTime = benchmarkNew();

console.log(`Old Time: ${oldTime.toFixed(2)} ms`);
console.log(`New Time: ${newTime.toFixed(2)} ms`);
console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}%`);
