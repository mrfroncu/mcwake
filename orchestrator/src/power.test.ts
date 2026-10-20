import assert from "node:assert/strict";
import { test } from "node:test";
import { exclusive, singleFlight } from "./power.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("operations take turns instead of overlapping", async () => {
  const order: string[] = [];
  const shutdown = exclusive("shutdown", async () => {
    order.push("shutdown:start");
    await pause(30);
    order.push("shutdown:end");
  });
  const wake = exclusive("wake", async () => {
    order.push("wake:start");
  });
  await Promise.all([shutdown, wake]);
  assert.deepEqual(order, ["shutdown:start", "shutdown:end", "wake:start"]);
});

test("a failed operation does not block the next one", async () => {
  await assert.rejects(exclusive("sleep", async () => Promise.reject(new Error("boom"))));
  assert.equal(await exclusive("wake", async () => "ran"), "ran");
});

test("concurrent wakes share one run", async () => {
  let runs = 0;
  const wake = singleFlight(async () => {
    runs++;
    await pause(10);
    return runs;
  });
  const [a, b] = await Promise.all([wake.run(), wake.run()]);
  assert.equal(runs, 1);
  assert.equal(a, b);
  assert.equal(wake.inFlight(), false);
});
