import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create companies
  const systemCompany = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000000' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'System Admin Group',
    },
  });

  const testCompany = await prisma.company.upsert({
    where: { id: '11111111-1111-1111-1111-111111111111' },
    update: {},
    create: {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test Property Management',
    },
  });

  // Test users from Cognito
  const users = [
    {
      id: 'b4d80438-3001-70e6-f642-0d2bce3b7f7e',
      email: 'admin@test.com',
      name: 'System Admin',
      role: UserRole.PLATFORM_ADMIN,
      companyId: systemCompany.id,
    },
    {
      id: 'f428b478-b031-709f-e1d9-e65e6913e17d',
      email: 'landlord@test.com',
      name: 'Test Landlord',
      role: UserRole.COMPANY_OWNER,
      companyId: testCompany.id,
    },
    {
      id: 'd4c82478-7041-70e4-bd55-02ca501321ab',
      email: 'tenant@test.com',
      name: 'Test Tenant',
      role: UserRole.TENANT,
      companyId: testCompany.id,
    },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { id: u.id },
      update: { email: u.email, name: u.name },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
      },
    });

    await prisma.companyUser.upsert({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: u.companyId,
        },
      },
      update: { role: u.role },
      create: {
        userId: user.id,
        companyId: u.companyId,
        role: u.role,
      },
    });
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
