import { Router } from 'express';
import { getTemporalClient } from '../config/temporal-client';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Basic health check
 *     description: Returns the status of the API server.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is online.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mywallet-api'
  });
});

/**
 * @openapi
 * /health/deep:
 *   get:
 *     summary: Deep health check
 *     description: Checks connections to external services like Temporal.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: All services healthy.
 *       503:
 *         description: One or more services are down.
 */
router.get('/health/deep', async (req, res) => {
  const checks: any = {
    api: 'ok'
  };

  try {
    await getTemporalClient();
    checks.temporal = 'connected';
  } catch (error) {
    checks.temporal = 'disconnected';
  }

  const healthyStatus = ['ok', 'connected'];
  const allHealthy = Object.values(checks).every(v => healthyStatus.includes(v as string));

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  });
});

export default router;
