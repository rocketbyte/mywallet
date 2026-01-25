/**
 * Ollama HTTP Client (Layer 4 - Frameworks & Drivers)
 * HTTP client for Ollama API (OpenAI-compatible)
 * Supports remote Ollama servers
 */
export class OllamaClient {
  constructor(
    private endpoint: string,  // e.g., http://192.168.1.100:11434
    private model: string       // e.g., phi3:mini
  ) {}

  /**
   * Send chat completion request to Ollama
   * Uses OpenAI-compatible API
   */
  async chat(messages: any[], options: any): Promise<any> {
    const url = `${this.endpoint}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...options
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check if Ollama server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET'
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available models from Ollama server
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Failed to get models: ${response.statusText}`);
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name) || [];
    } catch (error) {
      console.error('Error getting Ollama models:', error);
      return [];
    }
  }
}
