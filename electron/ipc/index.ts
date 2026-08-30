import { registerAuthHandlers } from './auth';
import { registerCategoryHandlers } from './categories';
import { registerMenuHandlers } from './menu';
import { registerPartnerHandlers } from './partners';
import { registerPartnerOwnershipHandlers } from './partnerOwnership';
import { registerOrderHandlers } from './orders';
import { registerPaymentHandlers } from './payments';
import { registerConsumptionPersonHandlers } from './consumptionPersons';
import { registerCustomerHandlers } from './customers';
import { registerReportHandlers } from './reports';
import { registerSettingsHandlers } from './settings';
import { registerSocialLinkHandlers } from './socialLinks';
import { registerPaymentAccountHandlers } from './paymentAccounts';
import { registerPrintHandlers } from './print';
import { registerBackupHandlers } from './backup';
import { registerUserHandlers } from './users';

/** Registers every IPC handler group. Called once on app ready. */
export function registerIpcHandlers() {
  registerAuthHandlers();
  registerUserHandlers();
  registerCategoryHandlers();
  registerMenuHandlers();
  registerPartnerHandlers();
  registerPartnerOwnershipHandlers();
  registerOrderHandlers();
  registerPaymentHandlers();
  registerConsumptionPersonHandlers();
  registerCustomerHandlers();
  registerReportHandlers();
  registerSettingsHandlers();
  registerSocialLinkHandlers();
  registerPaymentAccountHandlers();
  registerPrintHandlers();
  registerBackupHandlers();
}
