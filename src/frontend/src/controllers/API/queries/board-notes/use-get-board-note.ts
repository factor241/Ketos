import type { useQueryFunctionType } from "@/types/api";
import type { BoardNote } from "@/types/board";
import { api } from "../../api";
import { getURL } from "../../helpers/constants";
import { UseRequestProcessor } from "../../services/request-processor";
import { boardNoteKeys } from "./keys";
import { type BoardNoteWire, mapBoardNote } from "./wire";

export const useGetBoardNote: useQueryFunctionType<
  { noteId: string },
  BoardNote
> = ({ noteId }, options) => {
  const { query } = UseRequestProcessor();
  return query(
    boardNoteKeys.detail(noteId),
    async () =>
      mapBoardNote(
        (await api.get<BoardNoteWire>(`${getURL("BOARD_NOTES")}/${noteId}`))
          .data,
      ),
    {
      ...options,
      enabled: Boolean(noteId) && (options?.enabled ?? true),
    },
  );
};
