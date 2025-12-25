import { Router } from 'express';
import { getTemporalClient } from '../config/temporal-client';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mywallet-api'
  });
});

router.get('/health/deep', async (req, res) => {
  const checks: any = {
    api: 'ok'
  };

  // Check Temporal connection
  try {
    await getTemporalClient();
    checks.temporal = 'connected';
  } catch (error) {
    checks.temporal = 'disconnected';
  }

  const allHealthy = Object.values(checks).every(v => v === 'ok' || v === 'connected');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  });
});

export default router;
