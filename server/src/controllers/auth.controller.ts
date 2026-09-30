import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { currentUser, signToken } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const registerSchema = z.object({
  email: z
    .string()
    .email("A valid email address is required.")
    .toLowerCase()
    .trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128),
  name: z.string().min(1, "Name is required.").max(80).trim(),
});

const loginSchema = z.object({
  email: z
    .string()
    .email("A valid email address is required.")
    .toLowerCase()
    .trim(),
  password: z.string().min(1, "Password is required."),
});

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name } = registerSchema.parse(req.body);

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw ApiError.conflict("An account with that email already exists.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await User.create({ email, name, passwordHash });

  logger.info(`Registered user ${user.email}`);

  res.status(201).json({
    token: signToken({ userId: user.id, email: user.email }),
    user: { id: user.id, email: user.email, name: user.name },
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = loginSchema.parse(req.body);

  // select: false on passwordHash means it must be requested explicitly.
  const user = await User.findOne({ email }).select("+passwordHash");

  // Same generic message for both branches so the endpoint cannot be used to
  // enumerate which emails are registered.
  const invalid = ApiError.unauthorized("Incorrect email or password.");

  if (!user?.passwordHash) throw invalid;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw invalid;

  res.json({
    token: signToken({ userId: user.id, email: user.email }),
    user: { id: user.id, email: user.email, name: user.name },
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  const { userId } = currentUser(req);

  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.notFound("User no longer exists.");

  res.json({
    user: { id: user._id.toString(), email: user.email, name: user.name },
  });
}
