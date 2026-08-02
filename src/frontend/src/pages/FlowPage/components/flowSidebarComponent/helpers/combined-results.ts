import type { FuseResult } from "fuse.js";
import type { APIDataType } from "@/types/api";

type SidebarSearchItem = {
  category: string;
  key: string;
  [property: string]: unknown;
};

export const combinedResultsFn = (
  fuseResults: FuseResult<SidebarSearchItem>[],
  data: APIDataType,
) => {
  return Object.fromEntries(
    Object.entries(data).map(([category]) => {
      const categoryResults = fuseResults.filter(
        (result) => result.item.category === category,
      );
      const filteredItems = Object.fromEntries(
        categoryResults.map((result) => [result.item.key, result.item]),
      );
      return [category, filteredItems];
    }),
  );
};
