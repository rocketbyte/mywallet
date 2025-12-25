import { Client, Connection } from '@temporalio/client';
import { config } from './environment';

let client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (client) {
    return client;
  }

  const connection = await Connection.connect({
    address: config.temporal.address
  });

  client = new Client({
    connection,
    namespace: config.temporal.namespace
  });

  return client;
}
