import { verifyAccessToken } from "./jwt.js";

/**
 * Protejează orice rută — verifică access token-ul din header-ul
 * Authorization. Nu atinge deloc DB-ul (verificare pur criptografică,
 * rapidă), exact motivul pentru care access token-ul e separat de
 * refresh token (acela DA verifică în DB, la /refresh).
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Neautentificat" });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub; // disponibil în orice rută care folosește acest middleware
    next();
  } catch (err) {
    // token expirat sau semnătură invalidă — frontend-ul (authFetch) va
    // încerca automat /refresh la primirea acestui 401, apoi reface request-ul
    return res.status(401).json({ message: "Token expirat sau invalid" });
  }
}
