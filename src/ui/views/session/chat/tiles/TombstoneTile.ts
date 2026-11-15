import { SimpleTile } from "@thirdroom/hydrogen-view-sdk";

/** Buzzar: "Alice upgraded this room." in the timeline, shown as an announcement like membership changes. */
export class TombstoneTile extends SimpleTile {
  get shape() {
    return "announcement" as const;
  }

  get announcement() {
    const entry = (this as unknown as { _entry: { displayName?: string; sender: string } })._entry;
    return `${entry.displayName || entry.sender} upgraded this room.`;
  }
}
