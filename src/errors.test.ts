import { describe, expect, it } from "vitest";
import {
  AgentNotFoundError,
  AgentStateError,
  ApplicationError,
  CyclicDependencyError,
  getErrorCode,
  getStatusCode,
  KillSwitchActiveError,
  PermissionError,
  ResourceLimitError,
  TaskFailureError,
  ValidationError,
} from "./errors";

describe("ApplicationError subclasses", () => {
  it("AgentNotFoundError has correct statusCode and code", () => {
    const e = new AgentNotFoundError("abc");
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe("AGENT_NOT_FOUND");
    expect(e.message).toContain("abc");
    expect(e instanceof ApplicationError).toBe(true);
  });

  it("KillSwitchActiveError has correct statusCode and code", () => {
    const e = new KillSwitchActiveError();
    expect(e.statusCode).toBe(503);
    expect(e.code).toBe("KILL_SWITCH_ACTIVE");
  });

  it("PermissionError has correct statusCode and code", () => {
    const e = new PermissionError();
    expect(e.statusCode).toBe(403);
    expect(e.code).toBe("PERMISSION_DENIED");
  });

  it("ResourceLimitError stores limit details", () => {
    const e = new ResourceLimitError("agents", 10, 5);
    expect(e.statusCode).toBe(429);
    expect(e.code).toBe("RESOURCE_LIMIT_EXCEEDED");
    expect(e.limitType).toBe("agents");
    expect(e.current).toBe(10);
    expect(e.limit).toBe(5);
  });

  it("ResourceLimitError accepts custom statusCode", () => {
    const e = new ResourceLimitError("agents", 1, 1, 503);
    expect(e.statusCode).toBe(503);
  });

  it("CyclicDependencyError has correct codes", () => {
    const e = new CyclicDependencyError();
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("CYCLIC_DEPENDENCY");
  });

  it("ValidationError stores optional field", () => {
    const e = new ValidationError("bad input", "email");
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(e.field).toBe("email");
  });

  it("TaskFailureError stores optional reason", () => {
    const e = new TaskFailureError("failed", "timeout");
    expect(e.statusCode).toBe(400);
    expect(e.reason).toBe("timeout");
  });

  it("AgentStateError has correct codes", () => {
    const e = new AgentStateError();
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe("INVALID_AGENT_STATE");
  });
});

describe("getStatusCode", () => {
  it("returns statusCode for ApplicationError", () => {
    expect(getStatusCode(new AgentNotFoundError("x"))).toBe(404);
    expect(getStatusCode(new KillSwitchActiveError())).toBe(503);
  });

  it("returns 500 for unknown errors", () => {
    expect(getStatusCode(new Error("generic"))).toBe(500);
    expect(getStatusCode("string error")).toBe(500);
    expect(getStatusCode(null)).toBe(500);
  });
});

describe("getErrorCode", () => {
  it("returns code for ApplicationError", () => {
    expect(getErrorCode(new AgentNotFoundError("x"))).toBe("AGENT_NOT_FOUND");
  });

  it("returns INTERNAL_ERROR for unknown errors", () => {
    expect(getErrorCode(new Error("generic"))).toBe("INTERNAL_ERROR");
    expect(getErrorCode("oops")).toBe("INTERNAL_ERROR");
  });
});
