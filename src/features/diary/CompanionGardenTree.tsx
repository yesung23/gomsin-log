import treeStage1 from '@/assets/garden/garden-tree-stage-1-display-v1.webp';
import treeStage2 from '@/assets/garden/garden-tree-stage-2-display-v1.webp';
import treeStage3 from '@/assets/garden/garden-tree-stage-3-display-v1.webp';
import treeStage4 from '@/assets/garden/garden-tree-stage-4-display-v1.webp';
import { getCompanionGardenTreeHeightPx, type CompanionGardenStageLevel } from './companionGarden';

const GARDEN_TREE_ASSETS: Record<CompanionGardenStageLevel, string> = {
  1: treeStage1,
  2: treeStage2,
  3: treeStage3,
  4: treeStage4,
};

/**
 * Each growth stage is a complete, original transparent asset. Keeping the
 * canopy, trunk, roots, and grounding mound in one image avoids the stretched
 * source fragments and alpha seams that made the earlier composite look broken.
 */
export function CompanionGardenTree({
  level,
  togetherDays,
}: {
  level: CompanionGardenStageLevel;
  togetherDays: number;
}) {
  const height = getCompanionGardenTreeHeightPx(togetherDays);
  return (
    <div
      className="garden-tree pointer-events-none absolute bottom-[21%] left-0 z-[1] flex w-full justify-center landscape:bottom-[2%]"
      style={{ height: `min(76vw, ${height}px)` }}
      data-testid={`garden-tree-stage-${level}`}
      data-tree-asset-version="display-v1"
      data-tree-height={height}
      aria-hidden="true"
    >
      <img
        src={GARDEN_TREE_ASSETS[level]}
        alt=""
        draggable={false}
        data-testid={`garden-tree-art-${level}`}
        className="block h-full w-auto max-w-none select-none"
      />
    </div>
  );
}
