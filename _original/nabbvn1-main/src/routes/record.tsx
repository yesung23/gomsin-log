import { createFileRoute } from "@tanstack/react-router";
import { MobileShell } from "../components/MobileShell";
import { useStore } from "../lib/store";
import { GomshinHome } from "../features/GomshinHome";
import { SoldierHome } from "../features/SoldierHome";

export const Route = createFileRoute("/record")({
  component: RecordPage,
});

function RecordPage() {
  const { state } = useStore();
  return (
    <MobileShell>
      <div className="px-5 pt-12 pb-2">
        <h1 className="text-2xl font-bold">{state.partnerName}이의 기록</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {state.role === "gomshin" ? "오늘 남긴 마음을 다시 살펴봐요." : `${state.partnerName}이가 오늘 지나온 하루예요.`}
        </p>
      </div>
      {state.role === "gomshin" ? <GomshinHome /> : <SoldierHome />}
    </MobileShell>
  );
}
