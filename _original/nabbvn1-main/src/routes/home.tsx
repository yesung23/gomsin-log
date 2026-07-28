import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MobileShell } from "../components/MobileShell";
import { useStore } from "../lib/store";
import { GomshinHome } from "../features/GomshinHome";
import { SoldierHome } from "../features/SoldierHome";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

function HomePage() {
  const { state } = useStore();
  const navigate = useNavigate();
  useEffect(() => {
    if (!state.setup) navigate({ to: "/" });
  }, [state.setup, navigate]);

  return (
    <MobileShell>
      {state.role === "gomshin" ? <GomshinHome /> : <SoldierHome />}
    </MobileShell>
  );
}
