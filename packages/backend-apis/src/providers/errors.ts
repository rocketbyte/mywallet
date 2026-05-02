import type { EmailProviderType } from './types';

export class UnsupportedProviderError extends Error {
  readonly code = 'unsupported_provider';

  constructor(public readonly provider: string, supported: readonly EmailProviderType[]) {
    super(`Provider "${provider}" is not supported. Available: ${supported.join(', ') || '<none>'}.`);
    this.name = 'UnsupportedProviderError';
  }
}
