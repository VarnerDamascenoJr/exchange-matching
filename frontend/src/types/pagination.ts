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

export type PaginatedQuery = {
  page: number;
  pageSize: number;
  id?: string;
};

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
