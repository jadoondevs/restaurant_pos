import { registerAuthHandlers } from './auth';
import { registerCategoryHandlers } from './categories';
import { registerMenuHandlers } from './menu';
import { registerOrderHandlers } from './orders';
import { registerCustomerHandlers } from './customers';
import { registerReportHandlers } from './reports';
import { registerSettingsHandlers } from './settings';
import { registerPrintHandlers } from './print';
import { registerBackupHandlers } from './backup';
import { registerUserHandlers } from './users';

/** Registers every IPC handler group. Called once on app ready. */
export function registerIpcHandlers() {
  registerAuthHandlers();
  registerUserHandlers();
  registerCategoryHandlers();
  registerMenuHandlers();
  registerOrderHandlers();
  registerCustomerHandlers();
  registerReportHandlers();
  registerSettingsHandlers();
  registerPrintHandlers();
  registerBackupHandlers();
}
