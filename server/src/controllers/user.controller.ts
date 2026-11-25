import type { Request, Response } from 'express';
import { userService } from '../services/user.service.js';
import { UnauthorizedError } from '../utils/errors.js';
import { sendSuccess } from '../utils/apiResponse.js';

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
