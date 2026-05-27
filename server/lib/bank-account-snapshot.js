/**
 * Bank account snapshot helper.
 *
 * Invoices store a snapshot of the bank account they were created against so
 * historical PDFs remain stable when settings are later edited or deleted.
 * `resolveBankSnapshot(prisma, requestedId)` returns:
 *   { bank_account_id, bank_account_name, bank_sort_code, bank_account_number }
 * If `requestedId` is null/undefined, the default account is used.
 * If nothing exists at all, all fields are returned as null and the PDF
 * renderer falls back to the hardcoded COMPANY constants.
 */
async function resolveBankSnapshot(prisma, requestedId) {
  let account = null;
  const id = Number.isFinite(+requestedId) ? +requestedId : null;
  if (id) {
    account = await prisma.bankAccount.findUnique({ where: { id } });
  }
  if (!account) {
    account = await prisma.bankAccount.findFirst({ where: { is_default: true } });
  }
  if (!account) {
    return {
      bank_account_id: null,
      bank_account_name: null,
      bank_sort_code: null,
      bank_account_number: null,
    };
  }
  return {
    bank_account_id: account.id,
    bank_account_name: account.account_name,
    bank_sort_code: account.sort_code,
    bank_account_number: account.account_number,
  };
}

module.exports = { resolveBankSnapshot };
