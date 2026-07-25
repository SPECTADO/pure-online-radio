import { QueryClient } from "@tanstack/react-query";

/**
 * Extracted from main.tsx so non-component code (the upload queue store)
 * can invalidate queries after a background upload finishes, without
 * needing React context/hook access.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
