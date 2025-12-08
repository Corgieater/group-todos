import 'dotenv/config';
import type { PrismaConfig } from 'prisma/config';

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL');
}

export default {
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
} satisfies PrismaConfig;
