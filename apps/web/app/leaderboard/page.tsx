import { Leaderboard } from "@/components/leaderboard";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";

export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return (
    <PanelErrorBoundary label="leaderboard">
      <Leaderboard />
    </PanelErrorBoundary>
  );
}
