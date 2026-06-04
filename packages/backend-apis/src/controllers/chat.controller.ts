import { Request, Response } from 'express';
import { getDataOwnerId } from '../auth';
import { ChatService } from '../services/chat/chat.service';
import { logger } from '../utils/logger';
import {
  ChatRequestSchema,
  SSE_HEARTBEAT_MS,
  SSE_RETRY_MS,
  type ChatStreamEvent,
} from '../types/chat.types';

/**
 * Streams chat replies as Server-Sent Events. Each event is a JSON
 * payload of `ChatStreamEvent`; the client parses incrementally to drive
 * the streaming UI (typing indicator, live deltas, tool callouts).
 */
export class ChatController {
  private readonly service = new ChatService();

  async stream(req: Request, res: Response): Promise<void> {
    const userId = getDataOwnerId(req);

    const parsed = ChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      });
      return;
    }
    const { message, history = [] } = parsed.data;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: ${SSE_RETRY_MS}\n\n`);

    const send = (event: ChatStreamEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Keep proxies (nginx, ELB) from severing the connection while the
    // model is still thinking. Comment frames (`:` prefix) are ignored by
    // the EventSource spec, so the client never sees them.
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, SSE_HEARTBEAT_MS);

    // Forward client disconnects to the upstream LLM stream so we stop
    // burning tokens when the user navigates away.
    const controller = new AbortController();
    let clientGone = false;
    req.on('close', () => {
      clientGone = true;
      controller.abort();
    });

    try {
      for await (const event of this.service.stream({ userId, message, history, signal: controller.signal })) {
        if (clientGone) break;
        send(event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err) {
      logger.error('Chat stream failed', { err });
      if (!clientGone) send({ type: 'error', message: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      if (!clientGone) res.end();
    }
  }
}
