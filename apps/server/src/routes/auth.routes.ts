import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { signAuthToken } from "../utils/auth.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

// POST /api/auth/login — email + password → JWT (30d).
authRoutes.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required." });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ message: "Invalid email or password." });
      return;
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = signAuthToken({ userId: user.id, organizationId: user.organizationId, role: user.role });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  })
);

// GET /api/auth/me — current session.
authRoutes.get(
  "/me",
  authenticate(true),
  requireUser(),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId! },
      select: { id: true, email: true, name: true, role: true }
    });
    if (!user) {
      res.status(404).json({ message: "User not found." });
      return;
    }
    const org = await prisma.organization.findUnique({
      where: { id: req.auth!.organizationId },
      select: { id: true, name: true }
    });
    res.json({ user, organization: org });
  })
);
