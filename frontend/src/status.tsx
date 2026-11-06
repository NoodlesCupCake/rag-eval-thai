import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Status } from "./types";

interface Ctx {
  status: Status | null;
  refresh: () => void;
}

const StatusContext = createContext<Ctx>({ status: null, refresh: () => {} });

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const refresh = useCallback(() => {
    api.get<Status>("/status").then(setStatus).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  return <StatusContext.Provider value={{ status, refresh }}>{children}</StatusContext.Provider>;
}

export const useStatus = () => useContext(StatusContext);
