/**
 * Admin-configured payment accounts — the LIVE list of what the restaurant
 * currently accepts. Two independent toggles per account: isActive
 * (selectable for actual payment recording) and printOnReceipt (shown as
 * a payment instruction). See electron/ipc/payments.ts for how Payment
 * snapshots an account's details at the moment it's actually used — this
 * file only manages the live config, never historical payments.
 *
 * Accounts are never hard-deleted (isActive supports deactivation instead),
 * matching the Partner/ConsumptionPerson pattern — Payment rows reference
 * paymentAccountId with onDelete: SetNull, but their own snapshot fields
 * (accountDisplayName/accountNumberSnap/ibanSnap) stay correct regardless.
 */
import prisma from '../database/client';
import { handle } from './util';

const VALID_TYPES = ['CASH', 'EASYPAISA', 'BANK'];

interface PaymentAccountInput {
  type: string;
  displayName: string;
  accountHolderName?: string | null;
  phoneNumber?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
  iban?: string | null;
  isActive?: boolean;
  printOnReceipt?: boolean;
  sortOrder?: number;
}

function validate(data: PaymentAccountInput) {
  // type is an extensible string (see electron/utils/billing.ts) — the
  // known set is validated here, but a future method only needs adding
  // to VALID_TYPES, no schema change.
  if (!VALID_TYPES.includes(data.type)) {
    throw new Error(`Type must be one of: ${VALID_TYPES.join(', ')}.`);
  }
  if (!data.displayName?.trim()) throw new Error('Display name is required.');
}

export function registerPaymentAccountHandlers() {
  // Open — the POS checkout / receipt-printing path needs the active,
  // printable list, same trust level as settings:get.
  handle('paymentAccounts:list', async (_event) =>
    prisma.paymentAccount.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  );

  handle(
    'paymentAccounts:create',
    async (_event, data: PaymentAccountInput) => {
      validate(data);
      return prisma.paymentAccount.create({
        data: {
          type: data.type,
          displayName: data.displayName.trim(),
          accountHolderName: data.accountHolderName?.trim() || null,
          phoneNumber: data.phoneNumber?.trim() || null,
          bankName: data.bankName?.trim() || null,
          accountNumber: data.accountNumber?.trim() || null,
          iban: data.iban?.trim() || null,
          isActive: data.isActive ?? true,
          printOnReceipt: data.printOnReceipt ?? false,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'paymentAccounts:update',
    async (_event, { id, data }: { id: number; data: PaymentAccountInput }) => {
      validate(data);
      return prisma.paymentAccount.update({
        where: { id },
        data: {
          type: data.type,
          displayName: data.displayName.trim(),
          accountHolderName: data.accountHolderName?.trim() || null,
          phoneNumber: data.phoneNumber?.trim() || null,
          bankName: data.bankName?.trim() || null,
          accountNumber: data.accountNumber?.trim() || null,
          iban: data.iban?.trim() || null,
          isActive: data.isActive,
          printOnReceipt: data.printOnReceipt,
          sortOrder: data.sortOrder,
        },
      });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'paymentAccounts:setActive',
    async (_event, data: { id: number; isActive: boolean }) => {
      return prisma.paymentAccount.update({ where: { id: data.id }, data: { isActive: data.isActive } });
    },
    { requiredRole: 'ADMIN' }
  );
}
