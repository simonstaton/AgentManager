import { logger } from "./logger";

export type CredentialEventType = "create" | "read" | "inject" | "delete";

export interface CredentialAccessEvent {
  eventType: CredentialEventType;
  service: string;
  agentId?: string;
  workflowId?: string;
  caller?: string;
}

export function logCredentialAccess(event: CredentialAccessEvent): void {
  const { eventType, service, agentId, workflowId, caller } = event;
  logger.info(`[AUDIT] credential.${eventType}`, {
    service,
    ...(agentId !== undefined && { agentId }),
    ...(workflowId !== undefined && { workflowId }),
    ...(caller !== undefined && { caller }),
  });
}
