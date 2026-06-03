import { describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({ logger: { info: vi.fn() } }));

import { logger } from "./logger";
import { logCredentialAccess } from "./workflow-audit";

describe("logCredentialAccess", () => {
  it("logs with eventType and service", () => {
    logCredentialAccess({ eventType: "create", service: "github" });
    expect(logger.info).toHaveBeenCalledWith(
      "[AUDIT] credential.create",
      expect.objectContaining({ service: "github" }),
    );
  });

  it("includes optional agentId when provided", () => {
    logCredentialAccess({ eventType: "read", service: "linear", agentId: "abc" });
    expect(logger.info).toHaveBeenCalledWith("[AUDIT] credential.read", expect.objectContaining({ agentId: "abc" }));
  });

  it("includes workflowId when provided", () => {
    logCredentialAccess({ eventType: "inject", service: "github", workflowId: "wf-1" });
    expect(logger.info).toHaveBeenCalledWith(
      "[AUDIT] credential.inject",
      expect.objectContaining({ workflowId: "wf-1" }),
    );
  });

  it("does not include agentId key when not provided", () => {
    vi.mocked(logger.info).mockClear();
    logCredentialAccess({ eventType: "delete", service: "github" });
    const call = vi.mocked(logger.info).mock.calls[0];
    expect(call[1]).not.toHaveProperty("agentId");
  });
});
