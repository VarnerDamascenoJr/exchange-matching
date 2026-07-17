import { useDeferredValue, useMemo, useState } from 'react';
import { PAGE_SIZE_OPTIONS } from '../types/pagination';

const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

export function usePaginatedTableState(defaultPageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());

  const query = useMemo(
    () => ({
      page,
      pageSize,
      id: deferredSearch || undefined,
    }),
    [deferredSearch, page, pageSize],
  );

  return {
    page,
    pageSize,
    search,
    deferredSearch,
    query,
    setPage,
    setSearch: (nextSearch: string) => {
      setSearch(nextSearch);
      setPage(1);
    },
    setPageSize: (nextPageSize: number) => {
      setPageSize(nextPageSize);
      setPage(1);
    },
  };
}
