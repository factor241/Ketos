import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../index.tsx"), "utf8");
const genericNodeSource = readFileSync(
  resolve(__dirname, "../../../../../CustomNodes/GenericNode/index.tsx"),
  "utf8",
);
const handleSource = readFileSync(
  resolve(
    __dirname,
    "../../../../../CustomNodes/GenericNode/components/handleRenderComponent/index.tsx",
  ),
  "utf8",
);
const compactSource = source.replace(/\s+/g, " ");
const syntaxSource = source.replace(/\s+/g, "");

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("Page canvas read-only contract", () => {
  it("routes view, version preview, and runtime locks through one mutation gate", () => {
    expect(syntaxSource).toContain(
      "constisCanvasReadOnly=Boolean(view||isPreviewActive||effectiveLocked);",
    );

    const mutatingKeyboardHandlers = [
      ["function handleUndo", "function handleRedo"],
      ["function handleRedo", "function handleGroup"],
      ["function handleGroup", "function handleDuplicate"],
      ["function handleDuplicate", "function handleCopy"],
      ["function handleCut", "function handlePaste"],
      ["function handlePaste", "function handleDelete"],
      ["function handleDelete", "function handleEscape"],
    ] as const;

    for (const [start, end] of mutatingKeyboardHandlers) {
      expect(sourceBetween(start, end)).toContain(
        "if (isCanvasReadOnly) return;",
      );
    }

    expect(
      sourceBetween("const handleGroupNode", "useEffect(() => {"),
    ).toContain("if (isCanvasReadOnly) return;");
    expect(sourceBetween("const onConnectMod", "const [helperLines")).toContain(
      "if (isCanvasReadOnly) return;",
    );
    expect(sourceBetween("const onDrop", "const onEdgeUpdateStart")).toContain(
      "if (isCanvasReadOnly) return;",
    );
    expect(
      sourceBetween("const onNodeContextMenu", "const onPaneClick"),
    ).toContain("if (isCanvasReadOnly) return;");
    expect(
      sourceBetween("const handleStartAddNote", "window.addEventListener"),
    ).toContain("if (isCanvasReadOnly) return;");
  });

  it("disables every ReactFlow mutation surface and mutation-only canvas control", () => {
    const mutationProps = [
      "onConnect={isCanvasReadOnly ? undefined : onConnectMod}",
      "nodesDraggable={!isCanvasReadOnly}",
      "nodesConnectable={!isCanvasReadOnly}",
      "onReconnect={isCanvasReadOnly ? undefined : onEdgeUpdate}",
      "onReconnectStart={isCanvasReadOnly ? undefined : onEdgeUpdateStart}",
      "onReconnectEnd={isCanvasReadOnly ? undefined : onEdgeUpdateEnd}",
      "onNodeDrag={isCanvasReadOnly ? undefined : onNodeDrag}",
      "onNodeDragStart={isCanvasReadOnly ? undefined : onNodeDragStart}",
      "onSelectionDragStart={ isCanvasReadOnly ? undefined : onSelectionDragStart }",
      "onDragOver={isCanvasReadOnly ? undefined : onDragOver}",
      "onNodeDragStop={isCanvasReadOnly ? undefined : onNodeDragStop}",
      "onDrop={isCanvasReadOnly ? undefined : onDrop}",
      "onNodeContextMenu={ isCanvasReadOnly ? undefined : onNodeContextMenu }",
    ];

    for (const prop of mutationProps) {
      expect(syntaxSource).toContain(prop.replace(/\s+/g, ""));
    }

    expect(compactSource).toContain(
      "onNodesChange={onNodesChangeReadOnlyAware}",
    );
    expect(compactSource).toContain(
      "onEdgesChange={onEdgesChangeReadOnlyAware}",
    );
    expect(compactSource).toContain(
      'change.type === "select" || change.type === "dimensions"',
    );
    expect(compactSource).toContain(
      "<CanvasReadOnlyProvider readOnly={isCanvasReadOnly}>",
    );
    expect(compactSource).toContain("elementsSelectable={!isCanvasReadOnly}");
    expect(compactSource).toContain("{!isCanvasReadOnly && ( <SelectionMenu");
    expect(compactSource).toContain(
      "{!isCanvasReadOnly && <UpdateAllComponents />}",
    );
  });

  it("keeps copy, download, selection, and view pan/zoom policies intact", () => {
    expect(
      sourceBetween("function handleCopy", "function handleCut"),
    ).not.toContain("isCanvasReadOnly");
    expect(
      sourceBetween("function handleDownload", "const undoAction"),
    ).not.toContain("isCanvasReadOnly");

    expect(compactSource).toContain("elementsSelectable={!isCanvasReadOnly}");
    expect(compactSource).toContain("zoomOnScroll={!view}");
    expect(compactSource).toContain("zoomOnPinch={!view}");
    expect(compactSource).toContain("panOnDrag={!view}");
  });

  it("propagates the same gate into nested node mutations", () => {
    expect(genericNodeSource).toContain("useCanvasReadOnly()");
    expect(genericNodeSource).toContain("if (isCanvasReadOnly) return;");
    expect(genericNodeSource).toContain(
      "!isCanvasReadOnly && memoizedNodeToolbarComponent",
    );
    expect(handleSource).toContain("useCanvasReadOnly()");
    expect(handleSource).toContain("isInteractionLocked");
  });
});
