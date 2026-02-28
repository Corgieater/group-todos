import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon from 'argon2';
// 💡 請確保這裡的路徑指向你 generate 出來的 Client
import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
// 💡 官方方式：將 adapter 傳入 PrismaClient
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting seed...');

  // 1. 準備測試密碼 Hash
  const passwordHash = await argon.hash('test');

  // 2. 建立測試帳號 (使用 upsert 避免重複)
  const testUser = await prisma.user.upsert({
    where: { email: 'test@test.com' },
    update: {}, // 如果已存在則不更新
    create: {
      email: 'test@test.com',
      name: 'Test User',
      timeZone: 'Asia/Taipei',
      hash: passwordHash, // 你的 Model 欄位
    },
  });

  console.log('✅ Seed successful!', { user: testUser.email });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error('❌ Seed error:', e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
