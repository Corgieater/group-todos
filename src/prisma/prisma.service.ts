import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from 'src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // 建立一個專屬於 Prisma 的 Logger 標籤
  private readonly logger = new Logger('Prisma');

  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);

    // 1. 在這裡加入 log 設定
    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' }, // 監聽 SQL 指令
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    // 2. 訂閱事件並導向到 Winston
    // 注意：需要轉成 any，因為 Prisma 強型別有時會不匹配
    (this as any).$on('query', (e: any) => {
      // 只有在 debug 模式才印出 SQL，避免生產環境 log 爆炸
      this.logger.debug(`Query: ${e.query}`);
      this.logger.debug(`Params: ${e.params}`);
      this.logger.debug(`Duration: ${e.duration}ms`);
    });

    (this as any).$on('info', (e: any) => this.logger.log(e.message));
    (this as any).$on('warn', (e: any) => this.logger.warn(e.message));
    (this as any).$on('error', (e: any) => this.logger.error(e.message));

    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
