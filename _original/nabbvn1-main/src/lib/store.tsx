import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "gomshin" | "soldier";
export type CareKey = "listen" | "empathy" | "cheer" | "rest" | "miss" | "celebrate" | "none";

export interface AppState {
  setup: boolean;
  myName: string;
  partnerName: string;
  role: Role;
  dayLog: string;
  emotion: string;
  energy: number;
  care: CareKey;
  dischargeDate: string; // YYYY-MM-DD
  anniversaryDate: string; // YYYY-MM-DD, day 1
}

const DEFAULT_STATE: AppState = {
  setup: false,
  myName: "춘향",
  partnerName: "몽룡",
  role: "gomshin",
  dayLog: "오전 업무가 꼬여서 평소보다 많이 지쳤어요.",
  emotion: "😞",
  energy: 35,
  care: "empathy",
  dischargeDate: "2026-12-05",
  anniversaryDate: "2024-02-14",
};

const KEY = "nabbvn.state.v2";

interface Ctx {
  state: AppState;
  update: (patch: Partial<AppState>) => void;
  reset: () => void;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setState({ ...DEFAULT_STATE, ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState({ ...DEFAULT_STATE, setup: false });

  if (!hydrated) return null;
  return <StoreCtx.Provider value={{ state, update, reset }}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}
