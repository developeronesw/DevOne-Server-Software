export type HealthStatus = {
  ok: boolean;
  service: string;
  version: string;
};

export type AgentOperation = {
  id: string;
  operation: string;
  requestedBy: string;
  requiresConfirmation: boolean;
  input: Record<string, unknown>;
};
