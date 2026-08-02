import { useState } from "react";
import ForwardedIconComponent from "@/components/common/genericIconComponent";
import CustomFileCard from "@/customization/components/custom-file-card";
import { formatFileName } from "../utils/format";

export default function FileCardWrapper({
  index,
  path,
}: {
  index: number;
  path: { path: string; type: string; name: string } | string;
}) {
  const [show, setShow] = useState<boolean>(true);
  let name: string = "";
  let type: string = "";
  let pathString: string = "";
  if (typeof path === "string") {
    name = path.split("/").pop() || "";
    type = path.split(".").pop() || "";
    pathString = path;
  } else {
    name = path.name;
    type = path.type;
    pathString = path.path;
  }

  return (
    <div key={index} className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="flex cursor-pointer gap-2 border-0 bg-transparent p-0 text-sm text-muted-foreground"
        aria-expanded={show}
      >
        {formatFileName(name, 50)}
        <ForwardedIconComponent name={show ? "ChevronDown" : "ChevronRight"} />
      </button>
      <CustomFileCard
        showFile={show}
        fileName={name}
        fileType={type}
        path={pathString}
      />
    </div>
  );
}
