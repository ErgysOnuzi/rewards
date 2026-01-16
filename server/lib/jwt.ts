import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.SESSION_SECRET!;
const JWT_EXPIRY = "30d"; // 30 days to match session duration

export interface JwtPayload {
  userId: string;
  username: string;
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

export function refreshToken(token: string): string | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  return generateToken({ userId: payload.userId, username: payload.username });
}
