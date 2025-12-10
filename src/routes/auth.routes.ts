import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

export function createAuthRoutes(authController: AuthController): Router {
  const router = Router();

  router.get('/google', authController.initiateAuth);
  router.get('/google/callback', authController.handleCallback);
  router.post('/connect', authController.connectSpreadsheet);
  router.get('/status', authController.getStatus);
  router.post('/logout', authController.logout);

  return router;
}
