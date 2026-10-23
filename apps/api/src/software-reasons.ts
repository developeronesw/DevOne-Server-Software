// Public, non-secret allowlist for failed managed software job reasons.
// The Agent independently validates the same list against the shell's output.
// Keep both sets synchronized (regression tests assert exact parity).
export const safeInstallFailureReasons=[
 "agent_permissions","unsupported_ubuntu","unsupported_architecture","install_lock_busy",
 "nginx_inactive","nginx_configuration_invalid","devone_service_inactive",
 "disk_inventory_failed","disk_space_low","apt_policy_unavailable","apt_candidate_unavailable",
 "candidate_sources_unavailable","repository_metadata_unavailable","repository_origin_unverified",
 "apt_simulation_failed","protected_package_change","apt_transaction_failed","nginx_postcheck_failed",
 "devone_postcheck_failed","package_service_inactive","redis_socket_check_failed","redis_exposed","unclassified"
] as const;
export function isSafeInstallFailureReason(value:unknown):value is typeof safeInstallFailureReasons[number]{
 return typeof value==="string"&&safeInstallFailureReasons.some(x=>x===value);
}
