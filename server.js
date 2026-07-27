import "./env.js";

import express from "express";
import bcrypt from "bcrypt";
import cors from "cors";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
import { verifyConnection, sendMessage } from "./mailService.js";
import { storeCode, verifyCode, consumeCode } from "./verificationStore.js";
import { requireAuth } from "./requireAuth.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} from "./jwt.js";
import { requireAdmin } from "./requireAdmin.js";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const REFRESH_COOKIE_NAME = "refresh_token";
const IS_PROD = process.env.NODE_ENV === "production";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/api/auth",
    partitioned: "true",
    maxAge: REFRESH_TOKEN_TTL_MS,
  };
}

const adapter = new PrismaMariaDb({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  connectionLimit: 5,
});

export const prisma = new PrismaClient({ adapter });

async function issueTokenPair(res, userId) {
  const tokenId = uuidv4();
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId, tokenId);

  await prisma.refreshToken.create({
    data: {
      tokenId,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  return accessToken;
}
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {});

app.post("/api/auth/refresh", async (req, res) => {
  console.log("refresh token called");

  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) return res.status(401).json({ message: "Neautentificat" });

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res
      .status(401)
      .json({ message: "Sesiune invalidă, reautentifică-te" });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenId: payload.jti },
  });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    return res
      .status(401)
      .json({ message: "Sesiune invalidă, reautentifică-te" });
  }

  await prisma.refreshToken.update({
    where: { tokenId: payload.jti },
    data: { revoked: true },
  });

  const accessToken = await issueTokenPair(res, payload.sub);
  res.json({ accessToken });
});

app.patch("/api/user/profile", requireAuth, async (req, res) => {
  const { phoneNumber } = req.body;
  console.log(phoneNumber);

  try {
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { phoneNumber },
    });

    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        phoneNumber: updated.phoneNumber,
      },
    });
  } catch (err) {
    console.error("Eroare la actualizarea profilului:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.get("/api/user/profile", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user)
      return res.status(404).json({ message: "Utilizator inexistent" });
    console.log("se cere profilul de admin" + user.isAdmin);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        isAdmin: user.isAdmin,
      },
    });
  } catch (err) {
    console.error("Eroare la /profile:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ message: "Email sau parolă incorecte" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Email sau parolă incorecte" });
    }
    const accessToken = await issueTokenPair(res, user.id);
    console.log("====================================");
    console.log("user is admin " + user.isAdmin);
    console.log("====================================");
    res.json({
      accessToken,
      user: { id: user.id, email: user.email, isAdmin: user.isAdmin },
    });
  } catch (err) {
    console.error("Eroare la login:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, code } = req.body;

  const entry = verifyCode(email, code);

  if (entry.valid != true) {
    return res.status(400).json({ message: "Cod incorect sau expirat" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const userToCreate = {
      email,
      name,
      passwordHash,
      emailVerified: true,
    };
    const created = await prisma.user.create({ data: userToCreate });

    return res.status(200).json({ user: created });
  } catch (error) {
    console.log(error);
    return res.status(401);
  }
  return res.status(200);
});
app.post("/api/auth/send-verification", (req, res) => {
  console.log("code has to be send");
  const { email } = req.body;
  const code = storeCode(email);

  sendMessage({ email, code });
  res.send(200);
});
app.post("/api/auth/verify-code", (req, res) => {
  const { email, code } = req.body;

  const entry = verifyCode(email, code);

  if (entry.valid != true) {
    return res.status(400).json({ message: "Cod incorect" });
  }
  if (Date.now() > entry.expiresAt) {
    verificationCodes.delete(email);
    return res.status(400).json({ message: "Codul a expirat" });
  }

  res.send(200);
});
app.post("/change-password", (req, res) => {});
app.post("/delete-account", (req, res) => {});
app.get("/api/admin/invoices", (req, res) => {
  const Invoice = {
    id: number,
    customerName: string,
    customerAddress: string,
    amountPaid: number,
    issuedAt: string,
  };
  console.log("invoces is called");
  res.send(200);
  let mere = { nume: "mere", prenume: "alune" };
  res.json(mere);
});

app.post(
  "/api/admin/upload-signature",
  requireAuth,
  requireAdmin,
  (req, res) => {
    const { publicId } = req.body;
    if (!publicId) {
      return res.status(400).json({ message: "publicId lipsește" });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = "mirunaart/products";

    const paramsToSign = { timestamp, folder, public_id: publicId };
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET,
    );

    res.json({
      signature,
      timestamp,
      folder,
      publicId,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
    });
  },
);

app.post("/api/admin/artworks", requireAuth, requireAdmin, async (req, res) => {
  console.log("Adauagre opere in");

  const { name, price, dimentions, photoUrls } = req.body;

  if (
    !name ||
    price == null ||
    !Array.isArray(photoUrls) ||
    photoUrls.length === 0
  ) {
    return res
      .status(400)
      .json({ message: "Date lipsă (nume, preț sau imagini)" });
  }

  try {
    const product = await prisma.product.create({
      data: {
        name,
        price,
        ...(dimentions ? { dimentions } : {}), // altfel rămâne default "0x0"
        photoUrl: photoUrls[0], // preview-ul, ca înainte, în câmpul legacy
        photos: {
          create: photoUrls.map((url, index) => ({ url, position: index })),
        },
      },
      include: { photos: true },
    });

    res.status(201).json({ product });
  } catch (err) {
    console.error("Eroare la creare produs:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});
app.get("/api/products", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { status: "available" },
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        price: true,
        photoUrl: true,
      },
    });

    const formatted = products.map((p) => ({
      ...p,
      price: Number(p.price),
    }));

    res.json({ products: formatted });
  } catch (err) {
    console.error("Eroare la /api/products:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.listen(8080, () => {
  console.log(
    `server started on port 8080, frontend: ${process.env.FRONTEND_ORIGIN}`,
  );
});
