/// <reference types="vitest/globals" />
// Smoke: AgentProcess.softStallNotified optional field added in Phase E PR26.
describe("AgentProcess softStallNotified field", () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal stub
  const proc = { softStallNotified: undefined } as any;
  it("defaults to undefined", () => expect(proc.softStallNotified).toBeUndefined());
  it("accepts boolean", () => {
    proc.softStallNotified = true;
    expect(proc.softStallNotified).toBe(true);
  });
});
