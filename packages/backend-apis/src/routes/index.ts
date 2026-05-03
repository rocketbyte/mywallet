import { Router } from 'express';
import workflowRoutes from './workflow.routes';
import healthRoutes from './health.routes';
import emailRoutes from './email.routes';
import gmailWebhookRoutes from './gmail-webhook.routes';
import authRoutes from './auth.routes';
import pipelineRoutes from './pipeline.routes';
import transactionRoutes from './transaction.routes';
import budgetRoutes from './budget.routes';
import alertRoutes from './alert.routes';
import pendingRoutes from './pending.routes';
import tenantRoutes from './tenant.routes';

const router = Router();

router.use('/', healthRoutes);
router.use('/workflows', workflowRoutes);
router.use('/emails', emailRoutes);
router.use('/gmail', gmailWebhookRoutes);
router.use('/auth', authRoutes);
router.use('/pipeline', pipelineRoutes);
router.use('/transactions', transactionRoutes);
router.use('/budgets', budgetRoutes);
router.use('/alerts', alertRoutes);
router.use('/pending', pendingRoutes);
router.use('/tenants', tenantRoutes);

export default router;
