import type { Request, Response } from 'express';
import { userService } from '../services/user.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { REFRESH_COOKIE_NAME, setRefreshCookie } from '../utils/cookies.js';

export async function getMe(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to access user profile.');
  }

  const profile = await userService.getProfile(userId);
  // Preserves backward compatibility by returning profile directly, conforming to test 13
  res.status(200).json(profile);
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to update user profile.');
  }

  const updatedProfile = await userService.updateProfile(userId, req.body);
  sendSuccess(res, updatedProfile, 200, { message: 'User profile updated successfully.' });
}

export async function getPreferences(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to access preferences.');
  }

  const preferences = await userService.getPreferences(userId);
  sendSuccess(res, preferences, 200);
}

export async function updatePreferences(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to update preferences.');
  }

  const updatedPreferences = await userService.updatePreferences(userId, req.body);
  sendSuccess(res, updatedPreferences, 200, { message: 'Preferences updated successfully.' });
}

export async function updateMyEmail(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to update email.', 'UNAUTHORIZED');
  }

  const rawRefreshToken =
    typeof req.cookies?.[REFRESH_COOKIE_NAME] === 'string'
      ? req.cookies[REFRESH_COOKIE_NAME]
      : undefined;

  const result = await userService.updateEmail(userId, req.body, {
    callerFamilyId: req.user?.familyId,
    rawRefreshToken,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] as string | undefined,
  });

  if (result.rotatedRefreshToken) {
    setRefreshCookie(res, result.rotatedRefreshToken);
  }

  sendSuccess(
    res,
    { user: result.user, accessToken: result.accessToken },
    200,
    { message: 'Email address updated successfully.' }
  );
}

export async function updateMyPassword(req: Request, res: Response): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) {
    throw new UnauthorizedError('Authentication required to update password.', 'UNAUTHORIZED');
  }

  const rawRefreshToken =
    typeof req.cookies?.[REFRESH_COOKIE_NAME] === 'string'
      ? req.cookies[REFRESH_COOKIE_NAME]
      : undefined;

  const result = await userService.updatePassword(userId, req.body, {
    callerFamilyId: req.user?.familyId,
    rawRefreshToken,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'] as string | undefined,
  });

  if (result.rotatedRefreshToken) {
    setRefreshCookie(res, result.rotatedRefreshToken);
  }

  sendSuccess(
    res,
    { user: result.user, accessToken: result.accessToken },
    200,
    { message: 'Password updated successfully.' }
  );
}
