import { isEqual } from "lodash";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ReactSortable } from "react-sortablejs";
import ListSelectionComponent from "@/CustomNodes/GenericNode/components/ListSelectionComponent";
import type { ListSelectionItem } from "@/CustomNodes/GenericNode/components/ListSelectionComponent/ListItem";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { Button } from "@/components/ui/button";
import { getOptionLabel } from "@/utils/option-presentation";
import { cn } from "@/utils/utils";
import type { InputProps } from "../../types";
import HelperTextComponent from "../helperTextComponent";

type SortableListComponentProps = {
  tooltip?: string;
  name?: string;
  helperText?: string;
  helperMetadata?: Record<string, unknown>;
  options?: SortableListItemData[];
  optionsMetaData?: Array<Record<string, unknown>>;
  searchCategory?: string[];
  icon?: string;
  limit?: number;
};

type SortableListItemData = ListSelectionItem & {
  chosen?: boolean;
  selected?: boolean;
};

type SortableUiItem = SortableListItemData & { id: string | number };

const SYNTHETIC_SORTABLE_ID_PREFIX = "__langflow_sortable_";

function stripSortableState(item: SortableListItemData): SortableListItemData {
  const result = { ...item };
  delete result.chosen;
  delete result.selected;
  if (
    typeof result.id === "string" &&
    result.id.startsWith(SYNTHETIC_SORTABLE_ID_PREFIX)
  ) {
    delete result.id;
  }
  return result;
}

const SortableListItem = memo(
  ({
    data,
    index,
    onRemove,
    label,
    limit = 1,
    disabled,
  }: {
    data: SortableListItemData;
    index: number;
    onRemove: () => void;
    label: string;
    limit?: number;
    disabled?: boolean;
  }) => (
    <li
      className={cn(
        "inline-flex h-12 w-full items-center gap-2 text-sm font-medium",
        limit === 1 ? "h-6 rounded-md bg-muted" : "group cursor-grab",
      )}
    >
      {limit !== 1 && (
        <ForwardedIconComponent
          name="GridHorizontal"
          className="h-5 w-5 text-muted-foreground"
        />
      )}

      <div className="flex w-full items-center gap-x-2">
        {limit !== 1 && (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-border text-center text-mmd text-primary">
            {index + 1}
          </div>
        )}

        <span
          className={cn(
            "truncate text-xxs font-medium text-muted-foreground",
            limit === 1 ? "max-w-56 pl-2" : "max-w-48",
          )}
        >
          {label}
        </span>
      </div>
      <Button
        size="icon"
        variant={"ghost"}
        className={cn(
          "ml-auto h-6 w-6 text-muted-foreground opacity-0 transition-opacity duration-200",
          limit === 1
            ? "group pr-1 opacity-100 hover:text-foreground"
            : "hover:text-destructive group-hover:opacity-100",
        )}
        onClick={onRemove}
        disabled={disabled}
      >
        <ForwardedIconComponent name="x" className={cn("h-6 w-6")} />
      </Button>
    </li>
  ),
);

const SortableListComponent = ({
  tooltip = "",
  name,
  editNode = false,
  helperText = "",
  helperMetadata = { icon: undefined, variant: "muted-foreground" },
  options = [],
  optionsMetaData = [],
  searchCategory = [],
  limit,
  id,
  showParameter = true,
  disabled,
  ...baseInputProps
}: InputProps<SortableListItemData[], SortableListComponentProps>) => {
  const { placeholder, handleOnNewValue, value } = baseInputProps;
  const [open, setOpen] = useState(false);

  // Convert value to an array if it exists, otherwise use empty array
  const listData = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  // ReactSortable annotates list items with transient `chosen` / `selected`
  // fields. Give it presentation clones so persisted machine values and the
  // caller-owned objects remain byte-for-byte stable.
  const sortableListData = useMemo(
    () =>
      listData.map(
        (item, index): SortableUiItem => ({
          ...item,
          id: item.id ?? `${SYNTHETIC_SORTABLE_ID_PREFIX}${index}`,
        }),
      ),
    [listData],
  );

  const createRemoveHandler = useCallback(
    (index: number) => () => {
      if (disabled) return;
      const newList = listData.filter((_, i) => i !== index);
      handleOnNewValue({ value: newList });
    },
    [disabled, listData, handleOnNewValue],
  );

  const setListDataHandler = useCallback(
    (newList: SortableListItemData[]) => {
      if (disabled) return;
      const sanitizedNewList = newList.map(stripSortableState);
      const sanitizedListData = listData.map(stripSortableState);

      if (!isEqual(sanitizedNewList, sanitizedListData)) {
        handleOnNewValue({ value: sanitizedNewList });
      }
    },
    [disabled, listData, handleOnNewValue],
  );

  const handleCloseListSelectionDialog = useCallback(() => {
    setOpen(false);
  }, []);

  const handleOpenListSelectionDialog = useCallback(() => {
    if (disabled) return;
    if (helperText) {
      setShowHelperText(true);
    } else {
      setOpen(true);
    }
  }, [disabled, helperText]);

  const [showHelperText, setShowHelperText] = useState(false);

  useEffect(() => {
    if (!helperText) {
      setShowHelperText(false);
    }
    if (helperText && open) {
      setOpen(false);
    }
  }, [helperText, open]);

  if (!showParameter) {
    return null;
  }

  return (
    <div className="flex w-full flex-col">
      <div className="flex w-full flex-row gap-2">
        {!(limit === 1 && listData.length === 1) && (
          <Button
            variant="default"
            size="xs"
            role="combobox"
            onClick={handleOpenListSelectionDialog}
            disabled={disabled}
            className={cn(
              "dropdown-component-outline input-edit-node w-full",
              editNode ? "py-1" : "py-2",
            )}
            data-testid={
              id
                ? `button_open_list_selection_${id}`
                : "button_open_list_selection"
            }
          >
            <div
              className={cn(
                "flex items-center",
                editNode ? "text-xs" : "text-sm",
              )}
            >
              {placeholder}
            </div>
          </Button>
        )}
      </div>

      {listData.length > 0 && (
        <div className="flex w-full flex-col">
          <ReactSortable<SortableUiItem>
            disabled={disabled}
            list={sortableListData}
            setList={setListDataHandler}
            className={"flex w-full flex-col"}
          >
            {sortableListData.map((data, index) => (
              <SortableListItem
                key={`${data?.name || "item"}-${index}`}
                data={data}
                index={index}
                onRemove={createRemoveHandler(index)}
                label={getOptionLabel(
                  listData[index],
                  options,
                  optionsMetaData,
                )}
                limit={limit}
                disabled={disabled}
              />
            ))}
          </ReactSortable>
        </div>
      )}

      {helperText && showHelperText && (
        <div className="pt-2">
          <HelperTextComponent
            helperText={helperText}
            helperMetadata={helperMetadata}
          />
        </div>
      )}

      <ListSelectionComponent
        open={disabled ? false : open}
        onClose={handleCloseListSelectionDialog}
        searchCategories={searchCategory}
        editNode={editNode}
        setSelectedList={setListDataHandler}
        selectedList={listData}
        options={options}
        optionsMetaData={optionsMetaData}
        limit={limit}
        id={id}
        disabled={disabled}
        {...baseInputProps}
      />
    </div>
  );
};

export default memo(SortableListComponent);
