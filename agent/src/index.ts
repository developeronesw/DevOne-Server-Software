/**
 * DevOne Agent
 *
 * The Agent is the privileged host-operation boundary.
 * It must never expose unrestricted shell execution to the API or browser.
 * Phase 1 establishes the package and protocol boundary; privileged operations
 * are added only through explicit, validated operation handlers.
 */

export const agentVersion = "1.0.0-alpha.1";
