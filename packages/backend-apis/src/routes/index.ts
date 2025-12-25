import { Router } from 'express';
import workflowRoutes from './workflow.routes';
import healthRoutes from './health.routes';
import emailRoutes from './email.routes';
import scheduleRoutes from './schedule.routes';
import gmailWebhookRoutes from './gmail-webhook.routes';
import authRoutes from './auth.routes';

const router = Router();

router.use('/', healthRoutes);
router.use('/workflows', workflowRoutes);
router.use('/emails', emailRoutes);
router.use('/schedules', scheduleRoutes);
router.use('/gmail', gmailWebhookRoutes);
router.use('/auth', authRoutes);

export default router;
