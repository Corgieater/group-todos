import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from 'src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
// @Injectable()
// export class PrismaService implements OnModuleInit, OnModuleDestroy {
//   // 不再繼承，而是作為屬性
//   private prisma: PrismaClient;

//   constructor() {
//     const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//     const adapter = new PrismaPg(pool);
//     this.prisma = new PrismaClient({ adapter });
//   }

//   async onModuleInit() {
//     await this.prisma.$connect();
//   }

//   async onModuleDestroy() {
//     await this.prisma.$disconnect();
//   }

//   // 暴露 $transaction 方法，使用 $transaction 替換原本的 prisma.
//   $transaction<R>(
//     fn: (
//       tx: Omit<
//         PrismaClient,
//         | '$connect'
//         | '$disconnect'
//         | '$on'
//         | '$transaction'
//         | '$use'
//         | '$extends'
//       >,
//     ) => Promise<R>,
//   ): Promise<R> {
//     return this.prisma.$transaction(fn);
//   }

//   $queryRaw<T>(query: TemplateStringsArray, ...values: any[]): Promise<T> {
//     // 使用 this.prisma 上的 $queryRaw 方法
//     return this.prisma.$queryRaw<T>(query, ...values);
//   }

//   // 暴露所有模型的操作 (例如 task, groupMember)
//   // 這樣 TaskService 就可以直接使用 this.prismaService.task.findUnique
//   get task() {
//     return this.prisma.task;
//   }
//   get groupMember() {
//     return this.prisma.groupMember;
//   }
//   get user() {
//     return this.prisma.user;
//   }
//   get taskAssignee() {
//     return this.prisma.taskAssignee;
//   }
//   get actionToken() {
//     return this.prisma.actionToken;
//   }
//   get group() {
//     return this.prisma.group;
//   }
// }
