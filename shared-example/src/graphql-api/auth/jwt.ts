import jwt from 'jsonwebtoken';
import { AuthUser } from '../context';

// Demo-only secret/fallback — a real app must always set JWT_SECRET.
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-do-not-use-in-prod';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as unknown as AuthUser;
}
