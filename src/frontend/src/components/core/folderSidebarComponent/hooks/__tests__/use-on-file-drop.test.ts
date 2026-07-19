import { renderHook } from "@testing-library/react";
import type { FlowType } from "@/types/flow";
import useFileDrop from "../use-on-file-drop";

const mockSaveFlow = jest.fn();
const mockSetFolderDragging = jest.fn();
const mockSetFolderIdDragging = jest.fn();
const mockUploadFlowToFolder = jest.fn();
const mockSetErrorData = jest.fn();

let flowsManagerState: { flows: FlowType[] };
let folderState: {
  setFolderDragging: typeof mockSetFolderDragging;
  setFolderIdDragging: typeof mockSetFolderIdDragging;
  myCollectionId: string;
};

jest.mock("@/hooks/flows/use-save-flow", () => ({
  __esModule: true,
  default: () => mockSaveFlow,
}));

jest.mock(
  "@/controllers/API/queries/folders/use-post-upload-to-folder",
  () => ({
    usePostUploadFlowToFolder: () => ({ mutate: mockUploadFlowToFolder }),
  }),
);

jest.mock("react-i18next", () => ({
  __esModule: true,
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
}));

jest.mock("../../../../../stores/alertStore", () => ({
  __esModule: true,
  default: (
    selector: (state: { setErrorData: typeof mockSetErrorData }) => unknown,
  ) =>
    selector({
      setErrorData: mockSetErrorData,
    }),
}));

jest.mock("../../../../../stores/flowsManagerStore", () => {
  const useFlowsManagerStore = (
    selector?: (state: typeof flowsManagerState) => unknown,
  ) => (selector ? selector(flowsManagerState) : flowsManagerState);
  useFlowsManagerStore.getState = () => flowsManagerState;
  return {
    __esModule: true,
    default: useFlowsManagerStore,
  };
});

jest.mock("../../../../../stores/foldersStore", () => {
  const useFolderStore = (selector?: (state: typeof folderState) => unknown) =>
    selector ? selector(folderState) : folderState;
  useFolderStore.getState = () => folderState;
  return {
    useFolderStore,
  };
});

describe("useFileDrop.onDrop (drag-and-drop flow between projects)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const flowInProjectA = {
      id: "flow-1",
      name: "Flow One",
      description: "",
      data: null,
      folder_id: "project-A",
      is_component: false,
    } satisfies FlowType;

    flowsManagerState = {
      flows: [flowInProjectA],
    };

    folderState = {
      setFolderDragging: mockSetFolderDragging,
      setFolderIdDragging: mockSetFolderIdDragging,
      myCollectionId: "my-collection",
    };
  });

  it("should_call_saveFlow_with_new_folder_id_when_flow_is_dropped_into_empty_project", () => {
    const { result } = renderHook(() => useFileDrop("project-B"));

    const event = {
      dataTransfer: {
        getData: jest.fn((type: string) =>
          type === "flow"
            ? JSON.stringify({
                id: "flow-1",
                name: "Flow One",
                folder_id: "project-A",
              })
            : "",
        ),
        types: ["flow"],
      },
      preventDefault: jest.fn(),
    } as unknown as React.DragEvent<HTMLDivElement>;

    result.current.onDrop(event, "project-B");

    expect(mockSaveFlow).toHaveBeenCalledTimes(1);
    const savedFlow = mockSaveFlow.mock.calls[0][0];
    expect(savedFlow).toEqual(
      expect.objectContaining({
        id: "flow-1",
        folder_id: "project-B",
      }),
    );
    expect(mockSetFolderDragging).toHaveBeenCalledWith(false);
    expect(mockSetFolderIdDragging).toHaveBeenCalledWith("");
  });

  it("uses the project scope instead of a requested drop target", () => {
    const { result } = renderHook(() =>
      useFileDrop("legacy-fallback", {
        isProjectRoute: true,
        projectId: "project-P",
      }),
    );
    const event = {
      preventDefault: jest.fn(),
      dataTransfer: {
        files: [],
        getData: jest.fn(() => JSON.stringify({ id: "flow-1" })),
      },
    } as unknown as React.DragEvent<HTMLDivElement>;

    result.current.onDrop(event, "wrong-project");

    expect(mockSaveFlow).toHaveBeenCalledTimes(1);
    expect(mockSaveFlow.mock.calls[0][0].folder_id).toBe("project-P");
    expect(mockUploadFlowToFolder).not.toHaveBeenCalled();
  });

  it("blocks project drops when the project id is missing", () => {
    const { result } = renderHook(() =>
      useFileDrop("legacy-fallback", {
        isProjectRoute: true,
        projectId: null,
      }),
    );
    const event = {
      preventDefault: jest.fn(),
      dataTransfer: {
        files: [],
        getData: jest.fn(() => JSON.stringify({ id: "flow-1" })),
      },
    } as unknown as React.DragEvent<HTMLDivElement>;

    result.current.onDrop(event, "wrong-project");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockSaveFlow).not.toHaveBeenCalled();
    expect(mockUploadFlowToFolder).not.toHaveBeenCalled();
    expect(mockSetErrorData).toHaveBeenCalledWith({
      title: "projectShell.error",
    });
  });
});
