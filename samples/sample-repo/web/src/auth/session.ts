import { loadConfig } from '../config';

export interface Session {
  userId: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

/** Creates a session token for a user. */
export function createSession(userId: number): string {
  const token = 'token-' + userId + '-' + Date.now();
  const ttl = loadConfig().sessionTtlMinutes * 60_000;
  sessions.set(token, { userId, expiresAt: Date.now() + ttl });
  return token;
}

/** Returns the session for a token, or null when it is unknown or expired. */
export function verifyToken(token: string): Session | null {
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}
