import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __filenameRoot = fileURLToPath(import.meta.url);
const __dirnameRoot = path.dirname(__filenameRoot);

const prisma = new PrismaClient({
  datasources: {
    db: { url: `file:${path.resolve(__dirnameRoot, 'prisma/dev.db')}` },
  },
});

async function main() {
  const offers = await prisma.offer.findMany();
  console.log(JSON.stringify(offers.map(o => ({
    id: o.id,
    title: o.title.trim().replace(/\n/g, ''),
    shopifyDiscountId: o.shopifyDiscountId,
    type: o.type,
    shop: o.shop
  })), null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
