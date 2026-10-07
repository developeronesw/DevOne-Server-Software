import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
export const managedServices = ["nginx", "apache2", "mariadb", "mysql", "postgresql", "redis-server", "docker"] as const;
export function serviceOperation(body: unknown): { service: string; action: string } {
  const value = body as { service?: unknown; action?: unknown } | null;
  if (!value || !managedServices.includes(value.service as any) || !["start", "stop", "restart"].includes(value.action as string)) throw new Error("invalid_service_operation");
  return { service: value.service as string, action: value.action as string };
}
export async function listServices() {
  return Promise.all(managedServices.map(async service => {
    try {
      const { stdout } = await run("systemctl", ["show", `${service}.service`, "--property=LoadState,ActiveState,SubState", "--no-pager"], { timeout: 5000, maxBuffer: 16384 });
      return { service, ...Object.fromEntries(stdout.trim().split("\n").map(l => l.split("="))) };
    } catch { return { service, LoadState: "unknown", ActiveState: "unknown", SubState: "unknown" }; }
  }));
}
export async function mutateService(body: unknown) {
  const { service, action } = serviceOperation(body);
  await run("systemctl", [action, `${service}.service`], { timeout: 30000, maxBuffer: 16384 });
  return { ok: true, service, action };
}
