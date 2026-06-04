import { UnsupportedProviderError } from './errors';
import type { EmailProviderType, EmailProviderInterface } from './types';

/**
 * Registry of email providers keyed by their `type`. Controllers depend on
 * this abstraction (DIP) — to add a new provider, implement EmailProviderInterface
 * and register an instance, no other call sites change (OCP).
 */
export class EmailProviderRegistry {
  private readonly providers = new Map<EmailProviderType, EmailProviderInterface>();

  register(provider: EmailProviderInterface): this {
    this.providers.set(provider.type, provider);
    return this;
  }

  get(type: string): EmailProviderInterface {
    const provider = this.providers.get(type as EmailProviderType);
    if (!provider) throw new UnsupportedProviderError(type, this.supported());
    return provider;
  }

  has(type: string): boolean {
    return this.providers.has(type as EmailProviderType);
  }

  supported(): EmailProviderType[] {
    return [...this.providers.keys()];
  }
}
