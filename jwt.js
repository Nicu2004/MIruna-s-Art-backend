import jwt from "jsonwebtoken";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(userId) {
  return jwt.sign(
    { sub: userId, type: "access" },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL,
    },
  );
}

export function signRefreshToken(userId, tokenId) {
  return jwt.sign(
    { sub: userId, type: "refresh", jti: tokenId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL },
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}
