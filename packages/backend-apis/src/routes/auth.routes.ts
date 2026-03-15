import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();
const controller = new AuthController();

/**
 * GET /api/auth/gmail
 * Step 1: Get OAuth authorization URL
 *
 * Returns a page with a link to authorize Gmail access
 * Visit this in your browser to start the OAuth flow
 */
router.get('/gmail', (req, res) => controller.getAuthUrl(req, res));

/**
 * GET /api/auth/gmail/callback
 * Step 2: OAuth callback endpoint
 *
 * Google redirects here after user authorizes
 * Exchanges authorization code for refresh token
 * Displays the refresh token to copy into .env
 */
router.get('/gmail/callback', (req, res) => controller.handleCallback(req, res));

export default router;
