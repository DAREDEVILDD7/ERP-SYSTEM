import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:    30 * 1000,  // 30 seconds
      // `gcTime` in react-query v5 — this was still spelled `cacheTime` (the
      // v4 name), which v5 ignores. The value matches v5's default, so the key
      // fix changes nothing at runtime; it just makes the setting real again.
      gcTime:       5 * 60 * 1000, // 5 minutes
      retry:        1,
      refetchOnWindowFocus: false,
    },
  },
});