import { Prisma } from '@prisma/client';

export const buildIdPrefixFilter = (
  id?: string,
): Prisma.StringFilter | undefined => {
  const normalizedId = id?.trim();

  if (!normalizedId) {
    return undefined;
  }

  return {
    startsWith: normalizedId,
  };
};
