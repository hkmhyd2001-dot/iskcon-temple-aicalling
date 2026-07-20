import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate, requireUser } from "../middleware/auth.middleware.js";
import { audit } from "../utils/audit.js";

export const userRoutes = Router();

userRoutes.use(authenticate(true), requireUser());

const SAFE = { id: true, email: true, name: true, role: true, lastLoginAt: true, createdAt: true } as const;

// GET /api/users — list team members.
userRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { createdAt: "asc" },
      select: SAFE
    });
    res.json({ users });
  })
);

// POST /api/users — create a team member (admin only).
userRoutes.post(
  "/",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const name = String(req.body?.name ?? "").trim();
    const password = String(req.body?.password ?? "");
    const role = req.body?.role === "viewer" ? "viewer" : "admin";

    if (!email || !password) {
      res.status(400).json({ message: "Email and password are required." });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ message: "Password must be at least 6 characters." });
      return;
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      res.status(409).json({ message: "A user with that email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { organizationId: req.auth!.organizationId, email, name: name || null, passwordHash, role },
      select: SAFE
    });
    void audit(req.auth!.organizationId, "user.created", `Team member ${email} created (${role}).`, { userId: user.id });
    res.status(201).json({ user });
  })
);

// PATCH /api/users/:id — update name/role/password. Admins edit anyone; a user
// may change their own name/password.
userRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "User not found." });
      return;
    }
    const isAdmin = req.auth!.role === "admin";
    const isSelf = req.auth!.userId === id;
    if (!isAdmin && !isSelf) {
      res.status(403).json({ message: "Admin access required." });
      return;
    }

    const b = req.body ?? {};
    const data: Record<string, unknown> = {};
    if (typeof b.name === "string") data.name = b.name.trim() || null;
    if (isAdmin && (b.role === "admin" || b.role === "viewer")) data.role = b.role;
    if (typeof b.password === "string" && b.password) {
      if (b.password.length < 6) {
        res.status(400).json({ message: "Password must be at least 6 characters." });
        return;
      }
      data.passwordHash = await bcrypt.hash(b.password, 10);
    }

    // Never let the last admin be demoted.
    if (data.role === "viewer" && target.role === "admin") {
      const admins = await prisma.user.count({ where: { organizationId: req.auth!.organizationId, role: "admin" } });
      if (admins <= 1) {
        res.status(409).json({ message: "Can't demote the last admin — promote someone else first." });
        return;
      }
    }

    const user = await prisma.user.update({ where: { id }, data, select: SAFE });
    res.json({ user });
  })
);

// DELETE /api/users/:id — remove a member (admin only; not self, not last admin).
userRoutes.delete(
  "/:id",
  requireUser("admin"),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.organizationId !== req.auth!.organizationId) {
      res.status(404).json({ message: "User not found." });
      return;
    }
    if (req.auth!.userId === id) {
      res.status(409).json({ message: "You can't delete your own account." });
      return;
    }
    if (target.role === "admin") {
      const admins = await prisma.user.count({ where: { organizationId: req.auth!.organizationId, role: "admin" } });
      if (admins <= 1) {
        res.status(409).json({ message: "Can't delete the last admin." });
        return;
      }
    }
    await prisma.user.delete({ where: { id } });
    void audit(req.auth!.organizationId, "user.deleted", `Team member ${target.email} deleted.`, { userId: id });
    res.json({ ok: true });
  })
);
