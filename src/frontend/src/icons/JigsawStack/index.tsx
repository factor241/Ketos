import { forwardRef, type PropsWithChildren } from "react";
import JigsawStackIconSVG from "./JigsawStackIcon";

export const JigsawStackIcon = forwardRef<
  SVGSVGElement,
  PropsWithChildren<object>
>((props, ref) => {
  return <JigsawStackIconSVG ref={ref} {...props} />;
});
