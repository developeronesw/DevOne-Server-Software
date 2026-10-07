type Credentials = {
  getuid?: () => number; getgid?: () => number;
  setgroups?: (groups: number[]) => void; setgid?: (gid: number) => void; setuid?: (uid: number) => void;
};
export function dropSiteIdentity(uid: number, gid: number, credentials: Credentials = process) {
  if (credentials.getuid?.() !== 0 || !Number.isInteger(uid) || uid < 1000 || !Number.isInteger(gid) || gid < 1000 || !credentials.setgroups || !credentials.setgid || !credentials.setuid) throw new Error('invalid_site_identity');
  credentials.setgroups([]);
  credentials.setgid(gid);
  credentials.setuid(uid);
  if (credentials.getuid?.() !== uid || credentials.getgid?.() !== gid) throw new Error('identity_change_failed');
}
