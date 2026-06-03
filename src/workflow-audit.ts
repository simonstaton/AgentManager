import { logger } from "./logger";

/**
 * Workflow credential access audit trail.
 *
 * Logs structured [AUDIT] entries for every credential lifecycle event so that
 * operators can trace exactly when and how credentials were created, read,
 * injected into agent environments, or deleted.
 *
 * All events are emitted through the existing logger so they appear in the
 * same log stream as other server activity (JSON in production, coloured text
 * in development) and can be filtered with standard tooling.
 */

export type CredentialEventType = "create" | "read" | "inject" | "delete";

export interface CredentialAccessEvent {
  /** Type of operation performed on the credential. */
  eventType: CredentialEventType;
  /** Service / integration the credential belongs to (e.g. "github", "linear"). */
  service: string;
  /** Agent that performed the operation, if applicable. */
  agentId?: string;
  /** Workflow context this credential access belongs to, if applicable. */
  workflowId?: string;
  /** Caller location for traceability (e.g. "workflow-credentials:saveWorkflowCredentials"). */
  caller?: string;
}

/**
 * Log a credential access event to the audit trail.
 *
 * Example output (production JSON):
 *   {"level":"info","timestamp":"...","message":"[AUDIT] credential.create","service":"github","workflowId":"abc123","caller":"workflow-credentials:save"}
 */
export function logCredentialAccess(event: CredentialAccessEvent): void {
  const { eventType, service, agentId, workflowId, caller } = event;
  logger.info(`[AUDIT] credential.${eventType}`, {
    service,
    ...(agentId !== undefined && { agentId }),
    ...(workflowId !== undefined && { workflowId }),
    ...(caller !== undefined && { caller }),
  });
}
