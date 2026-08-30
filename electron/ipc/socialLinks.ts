/**
 * Admin-managed list of social/contact platforms for the receipt and any
 * future branding surfaces. A table (not fixed Settings columns) so a new
 * platform never requires a schema migration — see prisma/schema.prisma's
 * SocialLink model comment.
 */
import prisma from '../database/client';
import { handle } from './util';

const VALID_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'WEBSITE', 'OTHER'];

interface SocialLinkInput {
  platform: string;
  displayName: string;
  value: string;
  isEnabled?: boolean;
  showOnReceipt?: boolean;
  sortOrder?: number;
}

function validate(data: SocialLinkInput) {
  if (!VALID_PLATFORMS.includes(data.platform)) {
    throw new Error(`Platform must be one of: ${VALID_PLATFORMS.join(', ')}.`);
  }
  if (!data.displayName?.trim()) throw new Error('Display name is required.');
  if (!data.value?.trim()) throw new Error('A URL, phone number, or handle is required.');
}

export function registerSocialLinkHandlers() {
  // Open — the receipt-printing path (any authenticated user) needs the
  // enabled/showOnReceipt list, same trust level as settings:get.
  handle('socialLinks:list', async (_event) =>
    prisma.socialLink.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })
  );

  handle(
    'socialLinks:create',
    async (_event, data: SocialLinkInput) => {
      validate(data);
      return prisma.socialLink.create({
        data: {
          platform: data.platform,
          displayName: data.displayName.trim(),
          value: data.value.trim(),
          isEnabled: data.isEnabled ?? true,
          showOnReceipt: data.showOnReceipt ?? false,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'socialLinks:update',
    async (_event, { id, data }: { id: number; data: SocialLinkInput }) => {
      validate(data);
      return prisma.socialLink.update({
        where: { id },
        data: {
          platform: data.platform,
          displayName: data.displayName.trim(),
          value: data.value.trim(),
          isEnabled: data.isEnabled,
          showOnReceipt: data.showOnReceipt,
          sortOrder: data.sortOrder,
        },
      });
    },
    { requiredRole: 'ADMIN' }
  );

  handle(
    'socialLinks:delete',
    async (_event, id: number) => {
      await prisma.socialLink.delete({ where: { id } });
      return { success: true };
    },
    { requiredRole: 'ADMIN' }
  );
}
