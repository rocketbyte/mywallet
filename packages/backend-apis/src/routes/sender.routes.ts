import { Router } from 'express';
import { SenderController } from '../controllers/sender.controller';

const router = Router();
const controller = new SenderController();

/**
 * @openapi
 * /senders:
 *   get:
 *     summary: List watched senders
 *     description: |
 *       The tenant's sender watchlist. Only email from these senders is passed
 *       to the AI transaction pipeline; an empty list means no email is
 *       analyzed.
 *     tags: [Senders]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     responses:
 *       200:
 *         description: The tenant's watched senders, sorted by value.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/', controller.getSenders.bind(controller));

/**
 * @openapi
 * /senders:
 *   post:
 *     summary: Add a watched sender
 *     description: |
 *       Accepts a full email address or a bare domain (a leading `@` and
 *       display-name forms are tolerated). The value is normalized to
 *       lowercase; a domain entry matches the domain and all its subdomains.
 *       Re-adding an existing value is idempotent.
 *     tags: [Senders]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string, example: bancopopular.com.do }
 *               source: { type: string, enum: [manual, onboarding], default: manual }
 *     responses:
 *       201:
 *         description: The created (or pre-existing) watchlist entry.
 *       400:
 *         description: value is missing, or is neither an address nor a domain.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', controller.addSender.bind(controller));

/**
 * @openapi
 * /senders/{id}:
 *   delete:
 *     summary: Remove a watched sender
 *     tags: [Senders]
 *     parameters:
 *       - $ref: '#/components/parameters/UserId'
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Entry removed.
 *       404:
 *         description: No such entry for this tenant.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.delete('/:id', controller.removeSender.bind(controller));

export default router;
