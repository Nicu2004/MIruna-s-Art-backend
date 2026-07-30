import { prisma } from "./server.js";

export async function requireAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });

    if (!user?.isAdmin) {
      return res.status(403).json({ message: "Acces interzis" });
    }

    next();
  } catch (err) {
    console.error("Eroare la verificarea rolului de admin:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
}
