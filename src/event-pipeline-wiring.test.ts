/// <reference types="vitest/globals" />
import { EventPipeline } from "./event-pipeline";
// Smoke: EventPipeline is constructible and exposes required public methods.
describe("EventPipeline smoke", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  const ep = new EventPipeline(
    { get: () => undefined } as any,
    { upsertCostTracker: () => {} } as any,
    new Map(),
    () => {},
  );
  it("is an EventPipeline", () => expect(ep).toBeInstanceOf(EventPipeline));
  it("has handleEvent", () => expect(typeof ep.handleEvent).toBe("function"));
  it("has readPersistedEvents", () => expect(typeof ep.readPersistedEvents).toBe("function"));
});
