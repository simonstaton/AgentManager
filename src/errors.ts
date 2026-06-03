export abstract class ApplicationError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ApplicationError.prototype);
  }
}

export class AgentNotFoundError extends ApplicationError {
  readonly statusCode = 404;
  readonly code = "AGENT_NOT_FOUND";

  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    Object.setPrototypeOf(this, AgentNotFoundError.prototype);
  }
}

export class KillSwitchActiveError extends ApplicationError {
  readonly statusCode = 503;
  readonly code = "KILL_SWITCH_ACTIVE";

  constructor(message = "Kill switch is active") {
    super(message);
    Object.setPrototypeOf(this, KillSwitchActiveError.prototype);
  }
}

export class PermissionError extends ApplicationError {
  readonly statusCode = 403;
  readonly code = "PERMISSION_DENIED";

  constructor(message = "Permission denied") {
    super(message);
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

export class ResourceLimitError extends ApplicationError {
  readonly statusCode: number;
  readonly code = "RESOURCE_LIMIT_EXCEEDED";
  readonly limitType: string;
  readonly current: number;
  readonly limit: number;

  constructor(limitType: string, current: number, limit: number, statusCode = 429) {
    super(`${limitType} limit exceeded: ${current}/${limit}`);
    this.limitType = limitType;
    this.current = current;
    this.limit = limit;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ResourceLimitError.prototype);
  }
}

export class CyclicDependencyError extends ApplicationError {
  readonly statusCode = 400;
  readonly code = "CYCLIC_DEPENDENCY";

  constructor(message = "Operation would create a cyclic dependency") {
    super(message);
    Object.setPrototypeOf(this, CyclicDependencyError.prototype);
  }
}

export class ValidationError extends ApplicationError {
  readonly statusCode = 400;
  readonly code = "VALIDATION_FAILED";
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class TaskFailureError extends ApplicationError {
  readonly statusCode = 400;
  readonly code = "TASK_FAILED";
  readonly reason?: string;

  constructor(message: string, reason?: string) {
    super(message);
    this.reason = reason;
    Object.setPrototypeOf(this, TaskFailureError.prototype);
  }
}

export class AgentStateError extends ApplicationError {
  readonly statusCode = 400;
  readonly code = "INVALID_AGENT_STATE";

  constructor(message = "Invalid agent state") {
    super(message);
    Object.setPrototypeOf(this, AgentStateError.prototype);
  }
}

export function getStatusCode(error: unknown): number {
  if (error instanceof ApplicationError) return error.statusCode;
  return 500;
}

export function getErrorCode(error: unknown): string {
  if (error instanceof ApplicationError) return error.code;
  return "INTERNAL_ERROR";
}
