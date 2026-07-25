import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { useAuthStore } from "./lib/authStore";
import { queryClient } from "./lib/queryClient";
import "./index.css";

// Kick off the session check immediately so ProtectedRoute doesn't have to
// wait for a component to mount before it knows whether we're logged in.
useAuthStore.getState().hydrate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
