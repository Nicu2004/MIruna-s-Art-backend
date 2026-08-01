import "./env.js";
import { generateInvoicePdf } from "./generateInvoicePdf.js";
import { sendInvoiceEmail } from "./mailService.js";

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
import { sendBulkEventEmail } from "./mailService.js";
import { requireAdmin } from "./requireAdmin.js";
import cookieParser from "cookie-parser";
import { v4 as uuidv4 } from "uuid";
import { v2 as cloudinary } from "cloudinary";

const PORT = process.env.PORT || 8080;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const allowedOrigins = [
  "http://localhost:5173",
  "https://mirunas-art.vercel.app",
];
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
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  }),
);
console.log(process.env.FRONTEND_ORIGIN);
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

app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email lipsă" });

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    return res.json({
      message: "Dacă adresa există în sistem, vei primi un cod de resetare.",
    });
  }

  const code = storeCode(email);

  await sendMessage({
    email,
    code,
  });

  res.json({
    message: "Dacă adresa există în sistem, vei primi un cod de resetare.",
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ message: "Date lipsă" });
  }
  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ message: "Parola trebuie să aibă minim 8 caractere" });
  }

  const result = verifyCode(email, code);
  if (!result.valid) {
    return res.status(400).json({ message: "Cod incorect sau expirat" });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { email },
      data: { passwordHash },
    });

    consumeCode(email);

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revoked: false },
      data: { revoked: true },
    });

    res.json({ message: "Parola a fost schimbată cu succes" });
  } catch (err) {
    console.error("Eroare la resetarea parolei:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});
app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  console.log("se cere delogare");

  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await prisma.refreshToken.delete({ where: { tokenId: payload.jti } });
    } catch (err) {
      console.log(err);
    }

    res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
    res.json({ message: "Delogat" });
  }
});
app.post("/delete-account", (req, res) => {});

app.get("/api/admin/invoices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { issuedAt: "desc" },
    });

    const formatted = invoices.map((inv) => ({
      ...inv,
      amountPaid: Number(inv.amountPaid), // Decimal -> number, serializabil corect
    }));

    res.json({ invoices: formatted });
  } catch (err) {
    console.error("Eroare la /api/admin/invoices:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
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
        ...(dimentions ? { dimentions } : {}),
        photoUrl: photoUrls[0],
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
app.get("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { id: "desc" },
      select: {
        id: true,
        name: true,
        price: true,
        photoUrl: true,
        status: true,
        viewEnabled: true,
      },
    });

    const formatted = products.map((p) => ({ ...p, price: Number(p.price) }));
    res.json({ products: formatted });
  } catch (err) {
    console.error("Eroare la /api/admin/products:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});
app.patch(
  "/api/admin/products/:id/visibility",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { viewEnabled } = req.body;

    if (typeof viewEnabled !== "boolean") {
      return res
        .status(400)
        .json({ message: "viewEnabled trebuie să fie boolean" });
    }

    try {
      const product = await prisma.product.update({
        where: { id: Number(id) },
        data: { viewEnabled },
      });
      res.json({ product });
    } catch (err) {
      console.error("Eroare la schimbarea vizibilității:", err);
      res.status(500).json({ message: "Eroare internă" });
    }
  },
);

app.delete(
  "/api/admin/products/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      const existingOrders = await prisma.orderItem.findFirst({
        where: { productId: Number(id) },
      });

      if (existingOrders) {
        return res.status(409).json({
          message:
            "Acest produs are comenzi asociate — nu poate fi șters. Ascunde-l în loc, sau marchează-l ca vândut.",
        });
      }

      await prisma.productPhoto.deleteMany({
        where: { productId: Number(id) },
      });
      await prisma.product.delete({ where: { id: Number(id) } });

      res.json({ message: "Produs șters" });
    } catch (err) {
      console.error("Eroare la ștergerea produsului:", err);
      res.status(500).json({ message: "Eroare internă" });
    }
  },
);

app.get("/api/products", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { status: "available", viewEnabled: true },
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
app.get(
  "/api/admin/exhibitions",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const exhibitions = await prisma.exhibitions.findMany({
        orderBy: { date: "desc" },
        select: {
          id: true,
          title: true,
          date: true,
          location: true,
          description: true,
          status: true,
          viewEnabled: true,
        },
      });

      res.status(200).json(exhibitions);
    } catch (error) {
      res.status(500).json("internal error while feeding the exhibitions");
    }
  },
);
app.post(
  "/api/admin/exhibitions",
  requireAuth,
  requireAdmin,

  async (req, res) => {
    try {
      console.log(req.body);
      const exhibition = {
        title: req.body.title,
        date: new Date(req.body.date),
        location: req.body.location,
        description: req.body.description,
        status: req.body.status,
        viewEnabled: true,
      };
      const save = await prisma.exhibitions.create({ data: exhibition });

      const recipients = await prisma.user.findMany({
        orderBy: { email: "asc" },
        select: {
          email: true,
          name: true,
        },
      });
      recipients.push({
        email: "blendeadennis@gmail.com",
        name: "Blendea Dennis",
      });
      recipients.push({ email: "mara.anton12@gmail.com", name: "Mara Anton" });
      console.log("Succes saved event");
      sendBulkEventEmail(recipients, exhibition);
      res.status(200).json({ exhibition: save });
    } catch (err) {
      console.log(err);
    }
  },
);
app.delete(
  "/api/admin/exhibitions/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    try {
      const response = await prisma.exhibitions.delete({
        where: { id: Number(id) },
      });
      res.status(200).json({ status: "success" });
    } catch (errr) {
      console.log(error);
      res.status(500).json({ satus: "not deleted" });
    }
  },
);
app.patch(
  "/api/admin/exhibitions/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { title, date, location, description, status, viewEnabled } =
      req.body;

    try {
      const exhibition = await prisma.exhibitions.update({
        where: { id: Number(id) },
        data: {
          ...(title !== undefined && { title }),
          ...(date !== undefined && { date: new Date(date) }),
          ...(location !== undefined && { location }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status }),
          ...(viewEnabled !== undefined && { viewEnabled }),
        },
      });

      res.status(200).json({ exhibition });
    } catch (err) {
      console.error("Eroare la actualizarea evenimentului:", err);
      res.status(500).json({ message: "Eroare internă" });
    }
  },
);
app.get("/api/admin/orders", requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.query;

  if (!status) {
    return res.status(400).json({ message: "status lipsește din query" });
  }

  try {
    const orders = await prisma.order.findMany({
      where: { status: String(status) },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true } },
        items: {
          include: { product: { select: { name: true } } },
        },
      },
    });

    const formatted = orders.map((order) => ({
      id: order.id,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt,
      customerName: order.user.name,
      items: order.items.map((item) => ({
        productName: item.product.name,
        quantity: item.quantity,
        price: Number(item.price),
      })),
    }));

    res.json({ orders: formatted });
  } catch (err) {
    console.error("Eroare la /api/admin/orders:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});
app.get("/api/exhibitions", async (req, res) => {
  try {
    const result = await prisma.exhibitions.findMany({
      where: { viewEnabled: true },
      orderBy: { date: "desc" },
      select: {
        title: true,
        date: true,
        location: true,
        description: true,
        status: true,
        viewEnabled: true,
      },
    });
    res.status(200).json({ data: result });
  } catch (error) {
    res.status(401).json({ error: error });
  }
});

app.get("/api/artist", async (req, res) => {
  try {
    const artist = await prisma.artist.findFirst();
    if (!artist) return res.status(404).json({ message: "Artist inexistent" });
    res.json({ artist });
  } catch (err) {
    console.error("Eroare la /api/artist:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.get("/api/admin/artist", requireAuth, requireAdmin, async (req, res) => {
  try {
    const artist = await prisma.artist.findFirst({});
    res.json({ artist });
  } catch (err) {
    console.error("Eroare la /api/admin/artist:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});

app.patch("/api/admin/artist", requireAuth, requireAdmin, async (req, res) => {
  const { name, title, description } = req.body;

  if (!name || !title || !description) {
    return res
      .status(400)
      .json({ message: "Date lipsă (nume, titlu sau descriere)" });
  }

  try {
    const existing = await prisma.artist.findFirst();

    const artist = existing
      ? await prisma.artist.update({
          where: { id: existing.id },
          data: { name, title, description },
        })
      : await prisma.artist.create({ data: { name, title, description } });

    res.json({ artist });
  } catch (err) {
    console.error("Eroare la actualizarea artistului:", err);
    res.status(500).json({ message: "Eroare internă" });
  }
});
app.get(
  "/api/admin/invoices/:id/pdf",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
      });

      if (!invoice) {
        return res.status(404).json({ message: "Factura nu există" });
      }

      const pdfBuffer = await generateInvoicePdf(invoice);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="factura-INV-${String(invoice.id).padStart(4, "0")}.pdf"`,
      );
      res.send(pdfBuffer);
    } catch (err) {
      console.error("Eroare la generarea PDF-ului:", err);
      res.status(500).json({ message: "Eroare internă" });
    }
  },
);

app.post(
  "/api/admin/invoices/:id/send-email",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;

    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: Number(id) },
        include: { order: { include: { user: true } } },
      });

      if (!invoice) {
        return res.status(404).json({ message: "Factura nu există" });
      }

      const customerEmail = invoice.order.user.email;
      const pdfBuffer = await generateInvoicePdf(invoice);

      await sendInvoiceEmail(customerEmail, pdfBuffer, invoice);

      res.json({ message: `Factura a fost trimisă către ${customerEmail}` });
    } catch (err) {
      console.error("Eroare la trimiterea facturii:", err);
      res.status(500).json({ message: "Eroare internă" });
    }
  },
);

app.listen(PORT, async () => {
  console.log(
    `server started on port ${PORT}, frontend: ${process.env.FRONTEND_ORIGIN}`,
  );
  await verifyConnection();
});
