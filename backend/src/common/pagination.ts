export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type PaginatedResponse<TItem> = {
  items: TItem[];
  pagination: PaginationMeta;
};

export const buildPaginatedResponse = <TItem>(
  items: TItem[],
  page: number,
  pageSize: number,
  totalItems: number,
): PaginatedResponse<TItem> => ({
  items,
  pagination: {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  },
});
