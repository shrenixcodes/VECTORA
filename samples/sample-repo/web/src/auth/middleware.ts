import { type Session, verifyToken } from './session';

export interface AuthedRequest {
  headers: Record<string, string>;
  session?: Session;
}

export function requireAuth(req: AuthedRequest, res: { status(code: number): { end(): void } }, next: () => void): void {
  const session = verifyToken(req.headers.authorization ?? '');
  if (!session) {
    res.status(401).end();
    return;
  }
  req.session = session;
  next();
}
