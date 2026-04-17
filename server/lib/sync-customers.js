const prisma = require('../db/prisma');

module.exports = async function syncCustomers() {
  const jobs = await prisma.crmJob.findMany({
    where: { customer_id: null },
  });

  let synced = 0;
  for (const job of jobs) {
    try {
      let customerId = null;

      // Try to find an existing customer by email
      if (job.email) {
        const existing = await prisma.crmCustomer.findFirst({
          where: { email: job.email },
          select: { id: true },
        });
        if (existing) customerId = existing.id;
      }

      // Fall back to matching by exact name
      if (!customerId && job.full_name) {
        const existing = await prisma.crmCustomer.findFirst({
          where: { full_name: job.full_name },
          select: { id: true },
        });
        if (existing) customerId = existing.id;
      }

      // Create a new customer profile from job data
      if (!customerId) {
        const customer = await prisma.crmCustomer.create({
          data: {
            full_name: job.full_name,
            email: job.email || null,
            phone: job.phone || null,
            address_line1: job.from_line1 || null,
            city: job.from_city || null,
            postcode: job.from_postcode || null,
          },
        });
        customerId = customer.id;
        synced++;
      }

      await prisma.crmJob.update({
        where: { id: job.id },
        data: { customer_id: customerId },
      });
    } catch (err) {
      console.warn(`[sync-customers] skipped job ${job.id}:`, err.message);
    }
  }

  return synced;
};
