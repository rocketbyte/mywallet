import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { chatLimiter } from '../middleware/rate-limit';

const router = Router();
const controller = new ChatController();

/**
 * @openapi
 * /chat:
 *   post:
 *     summary: Stream a chat reply from Mintly
 *     description: |
 *       Sends a user message to the Mintly chat agent and streams the
 *       reply as Server-Sent Events. The agent decides at runtime which
 *       database queries to issue (tool calls); only the relevant rows
 *       are fed back into the model, keeping context small.
 *
 *       **Event types** (one JSON payload per `data:` frame):
 *       - `delta` — text chunk to append to the streaming bubble.
 *       - `tool_call` — model invoked a tool; UI may show "looking up…".
 *       - `tool_result` — server executed the tool and returned data.
 *       - `done` — model finished; close the stream.
 *       - `error` — fatal failure; close the stream.
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 description: The user's latest turn.
 *               history:
 *                 type: array
 *                 description: Recent conversation turns (server trims to the last 12).
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string }
 *     responses:
 *       200:
 *         description: SSE stream of `ChatStreamEvent` JSON payloads.
 *         content:
 *           text/event-stream:
 *             schema: { type: string }
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/', chatLimiter, (req, res) => controller.stream(req, res));

export default router;
