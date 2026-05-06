import { Request, Response } from 'express';
import { getUserId } from '../auth';
import { ChatService, type ChatStreamEvent, type ChatTurn } from '../services/chat/chat.service';
import { logger } from '../utils/logger';

const SSE_RETRY_MS = 2000;

interface StreamRequestBody {
  message?: unknown;
  history?: unknown;
}

/**
 * Streams chat replies as Server-Sent Events. Each event is a JSON
 * payload of `ChatStreamEvent`; the client parses incrementally to drive
 * the streaming UI (typing indicator, live deltas, tool callouts).
 */
export class ChatController {
  private readonly service = new ChatService();

  async stream(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const body = (req.body ?? {}) as StreamRequestBody;

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      res.status(400).json({ error: 'bad_request', message: 'message is required' });
      return;
    }
    const history = parseHistory(body.history);

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

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    try {
      for await (const event of this.service.stream({ userId, message, history })) {
        if (aborted) break;
        send(event);
        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err) {
      logger.error('Chat stream failed', { err });
      if (!aborted) send({ type: 'error', message: (err as Error).message });
    } finally {
      if (!aborted) res.end();
    }
  }
}

function parseHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return [];
    return [{ role, content }];
  });
}
