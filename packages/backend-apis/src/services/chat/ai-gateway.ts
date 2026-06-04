import OpenAI from 'openai';
import { config } from '../../config/environment';
import { logger } from '../../utils/logger';

let client: OpenAI | null = null;

/**
 * Returns a singleton OpenAI SDK instance configured to talk to the
 * project's LiteLLM gateway. Reuses the worker's env contract — set
 * LITELLM_BASE_URL, LITELLM_API_KEY, OPENAI_MODEL exactly as you do for
 * the temporal worker and chat will pick them up automatically.
 */
export function getAiClient(): OpenAI {
  if (client) return client;
  if (!config.litellm.baseURL || !config.litellm.apiKey) {
    throw new Error(
      'LiteLLM is not configured — set LITELLM_BASE_URL and LITELLM_API_KEY (same values the temporal worker uses).'
    );
  }
  client = new OpenAI({
    apiKey: config.litellm.apiKey,
    baseURL: config.litellm.baseURL,
    defaultHeaders: {
      'x-api-key': config.litellm.apiKey,
      'anthropic-version': '2023-06-01',
      // The WAF in front of the gateway blocks the SDK's default
      // `OpenAI/JS` UA. Override so requests aren't 403'd.
      'User-Agent': 'mywallet-backend',
    },
  });
  logger.info('Chat AI client initialized', {
    baseURL: config.litellm.baseURL,
    model: config.litellm.chatModel,
  });
  return client;
}

export const CHAT_MODEL = config.litellm.chatModel;
export const CHAT_BASE_URL = config.litellm.baseURL;
