import { Router } from 'express';
import {
  register,
  login,
  googleAuth,
  getGoogleAuthConfig,
  refresh,
  logout,
  getMe,
} from '../controllers/auth.controller.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { registerSchema, loginSchema, googleAuthSchema } from '../schemas/auth.schema.js';
import {
  registerLimiter,
  loginLimiter,
  refreshLimiter,
} from '../middlewares/rateLimiter.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import {
  validateRequestOrigin,
  requireCsrfHeader,
} from '../middlewares/csrf.middleware.js';

export const authRouter = Router();

// Apply origin and referer validation to all state-changing auth endpoints
authRouter.use(validateRequestOrigin);

authRouter.get('/google/config', (req, res) => getGoogleAuthConfig(req, res));
authRouter.post('/register', registerLimiter, validateBody(registerSchema), register);
authRouter.post('/login', loginLimiter, validateBody(loginSchema), login);
authRouter.post(
  '/google',
  loginLimiter,
  requireCsrfHeader,
  validateBody(googleAuthSchema),
  (req, res) => googleAuth(req, res)
);
authRouter.post('/refresh', refreshLimiter, requireCsrfHeader, refresh);
authRouter.post('/logout', requireCsrfHeader, logout);
authRouter.get('/me', requireAuth, getMe);
