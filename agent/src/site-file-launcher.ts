import { dropSiteIdentity } from './site-identity.js';
// Trusted registry metadata comes from the Agent, never from request JSON.
try {
  dropSiteIdentity(Number(process.env.DEVONE_SITE_UID),Number(process.env.DEVONE_SITE_GID));
  // Read input only after supplementary groups and both identities are changed.
  await import('./site-file-worker.js');
} catch { process.exit(1); }
