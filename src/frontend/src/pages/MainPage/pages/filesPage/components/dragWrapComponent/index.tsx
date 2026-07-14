import { type DragEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useFlowsManagerStore from "@/stores/flowsManagerStore";
import { cn } from "@/utils/utils";

export default function DragWrapComponent({
  onFileDrop,
  children,
}: {
  onFileDrop?: (event: DragEvent<HTMLDivElement>) => void;
  children: JSX.Element | JSX.Element[];
}) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const isIOModalOpen = useFlowsManagerStore((state) => state.IOModalOpen);
  useEffect(() => {
    // Function to handle visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Reset hover state or perform any necessary actions when the tab becomes visible again
        setIsDragging(false);
      }
    };

    // Add event listener for visibility change
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup event listener on component unmount
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const dragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setMousePosition({ x: e.clientX, y: e.clientY });
    if (
      e.dataTransfer.types.some((types) => types === "Files") &&
      onFileDrop &&
      !isIOModalOpen
    ) {
      setIsDragging(true);
    }
  };

  const dragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (
      e.dataTransfer.types.some((types) => types === "Files") &&
      onFileDrop &&
      !isIOModalOpen
    ) {
      setIsDragging(true);
    }
    e.preventDefault();
  };

  const dragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (onFileDrop && !isIOModalOpen) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (onFileDrop && !isIOModalOpen) onFileDrop(e);
    setIsDragging(false);
  };

  const image = `url("data:image/svg+xml,%3Csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='100%25' height='100%25' fill='none' rx='16' ry='16' stroke='%23FFFFFF' stroke-width='2px' stroke-dasharray='5%2c 5' stroke-dashoffset='0' stroke-linecap='butt'/%3E%3C/svg%3E")`;

  return (
    <div
      onDragOver={dragOver}
      onDragEnter={dragEnter}
      onDragLeave={dragLeave}
      onDrop={onDrop}
      className={cn("relative h-full w-full transition-all")}
      data-testid="drag-wrap-component"
      role="region"
      aria-label={t("files.dropToUpload")}
    >
      <div
        className={cn(
          "h-full w-full transition-all",
          isDragging ? "opacity-50" : "",
        )}
      >
        {children}
      </div>

      <div
        className={cn(
          "pointer-events-none absolute top-0 h-full w-full rounded-2xl bg-placeholder-foreground transition-all",
          isDragging ? "opacity-100" : "opacity-0",
        )}
        style={{
          WebkitMaskImage: image,
          maskImage: image,
        }}
      />

      {isDragging && (
        <div
          className="pointer-events-none fixed -translate-x-1/2"
          style={{
            left: `${mousePosition.x}px`,
            top: `${mousePosition.y + 55}px`,
          }}
        >
          <div className="w-44 rounded-2xl bg-accent-indigo-foreground px-2.5 py-0.5 text-center backdrop-blur-sm">
            <span className="font-mono text-xs text-primary-foreground">
              {t("files.dropToUpload")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
