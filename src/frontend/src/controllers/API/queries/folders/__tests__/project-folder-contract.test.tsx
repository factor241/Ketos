import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mockApiPost = jest.fn();
const mockApiPatch = jest.fn();
const mockQueryClient = {
  refetchQueries: jest.fn(),
  invalidateQueries: jest.fn(),
};

jest.mock("@/controllers/API/api", () => ({
  api: { post: mockApiPost, patch: mockApiPatch },
}));

jest.mock("@/controllers/API/helpers/constants", () => ({
  getURL: jest.fn(() => "/api/v1/projects"),
}));

jest.mock("@/controllers/API/services/request-processor", () => ({
  UseRequestProcessor: jest.fn(() => ({
    mutate: jest.fn(
      (
        _key: unknown,
        fn: (payload: unknown) => Promise<unknown>,
        options?: {
          onSuccess?: (result: unknown) => void;
          onSettled?: (result: unknown) => void;
        },
      ) => ({
        mutate: async (payload: unknown) => {
          const result = await fn(payload);
          options?.onSuccess?.(result);
          options?.onSettled?.(result);
          return result;
        },
      }),
    ),
    queryClient: mockQueryClient,
  })),
}));

import type { ProjectType } from "@/pages/MainPage/entities";
import { usePatchFolders } from "../use-patch-folders";
import { usePostFolders } from "../use-post-folders";

const folderPayload = {
  name: "Project",
  description: "",
  parent_id: null,
  flows: [],
  components: [],
};

type AsyncMutation<TPayload> = {
  mutate: (payload: TPayload) => Promise<unknown>;
};

describe("project folder client contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates once through the canonical project endpoint and refetches the folder list", async () => {
    const response = { id: "project-1", ...folderPayload };
    mockApiPost.mockResolvedValueOnce({ data: response });

    const mutation = usePostFolders() as unknown as AsyncMutation<{
      data: typeof folderPayload;
    }>;
    const result = await mutation.mutate({ data: folderPayload });

    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith("/api/v1/projects/", {
      name: "Project",
      description: "",
      flows_list: [],
      components_list: [],
    });
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(1);
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ["useGetFolders"],
    });
    expect(result).toEqual(response);
  });

  it("renames once through the canonical project endpoint and refetches the folder list", async () => {
    const response = { id: "project-1", ...folderPayload, name: "Renamed" };
    mockApiPatch.mockResolvedValueOnce({ data: response });

    const mutation = usePatchFolders() as unknown as AsyncMutation<{
      folderId: string;
      data: typeof folderPayload;
    }>;
    const result = await mutation.mutate({
      folderId: "project-1",
      data: { ...folderPayload, name: "Renamed" },
    });

    expect(mockApiPatch).toHaveBeenCalledTimes(1);
    expect(mockApiPatch).toHaveBeenCalledWith("/api/v1/projects/project-1", {
      name: "Renamed",
      description: "",
      flows_list: [],
      components_list: [],
    });
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledTimes(1);
    expect(mockQueryClient.refetchQueries).toHaveBeenCalledWith({
      queryKey: ["useGetFolders"],
    });
    expect(result).toEqual(response);
  });

  it("keeps list and detail queries in the existing folder cache namespace", () => {
    const foldersSource = readFileSync(
      resolve(__dirname, "..", "use-get-folders.ts"),
      "utf8",
    );
    const detailSource = readFileSync(
      resolve(__dirname, "..", "use-get-folder.ts"),
      "utf8",
    );

    expect(foldersSource).toContain('query(["useGetFolders"],');
    expect(detailSource).toMatch(/"useGetFolder",\s*params\.id/);
    expect(foldersSource).not.toContain('["projects"]');
    expect(detailSource).not.toContain('["projects"]');
  });

  it("does not introduce a parallel projects query or store namespace", () => {
    expect(existsSync(resolve(__dirname, "..", "..", "projects"))).toBe(false);

    for (const filename of [
      "projectsStore.ts",
      "projectsStore.tsx",
      "projectsStore.js",
    ]) {
      expect(
        existsSync(
          resolve(__dirname, "..", "..", "..", "..", "..", "stores", filename),
        ),
      ).toBe(false);
    }
  });

  it("exposes ProjectType as the Folder entity contract", () => {
    const project: ProjectType = {
      name: "Project",
      description: "",
      id: "project-1",
      parent_id: "root",
      flows: [],
      components: [],
    };

    expect(project.id).toBe("project-1");
  });
});
