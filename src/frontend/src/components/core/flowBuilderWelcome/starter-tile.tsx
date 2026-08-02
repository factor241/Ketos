import ForwardedIconComponent from "@/components/common/genericIconComponent";
import { cn } from "@/utils/utils";

type StarterTileProps = {
  icon: string;
  label: string;
  description?: string;
  testId: string;
  labelTestId?: string;
  className?: string;
} & (
  | {
      radio: {
        name: string;
        checked: boolean;
        onChange: () => void;
      };
      onClick?: never;
    }
  | {
      radio?: never;
      onClick: () => void;
    }
);

function TileContents({
  icon,
  label,
  labelTestId,
  description,
}: Pick<StarterTileProps, "icon" | "label" | "labelTestId" | "description">) {
  return (
    <>
      <ForwardedIconComponent
        name={icon}
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
      />
      <span className="min-w-0 text-center leading-snug">
        <span data-testid={labelTestId} className="block whitespace-normal">
          {label}
        </span>
        {description ? (
          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="h-4 w-4" />
    </>
  );
}

export function StarterTile(props: StarterTileProps) {
  const classes = cn(
    "grid min-h-16 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-2.5 rounded-xl border bg-muted px-4 py-2.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-border focus-within:ring-2 focus-within:ring-ring focus-visible:ring-2 focus-visible:ring-ring",
    props.radio?.checked ? "border-primary bg-accent" : "border-border",
    props.className,
  );
  if (props.radio) {
    return (
      <label className={cn(classes, "cursor-pointer")}>
        <input
          type="radio"
          name={props.radio.name}
          checked={props.radio.checked}
          data-testid={props.testId}
          className="sr-only"
          onChange={props.radio.onChange}
        />
        <TileContents {...props} />
      </label>
    );
  }
  return (
    <button
      type="button"
      data-testid={props.testId}
      onClick={props.onClick}
      className={classes}
    >
      <TileContents {...props} />
    </button>
  );
}
