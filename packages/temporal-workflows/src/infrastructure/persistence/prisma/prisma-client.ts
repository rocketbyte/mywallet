/**
 * Prisma Client Singleton (Layer 3 - Infrastructure)
 * One instance per process — safe for Temporal workers.
 */
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!client) {
    client = new PrismaClient();
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
