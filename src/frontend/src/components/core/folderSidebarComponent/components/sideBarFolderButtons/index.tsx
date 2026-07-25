import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "react-router-dom";
import { BoardCreationDialog } from "@/components/core/boardCreationWizard/BoardCreationDialog";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useUpdateUser } from "@/controllers/API/queries/auth";
import {
  usePatchFolders,
  usePostFolders,
  usePostUploadFolders,
} from "@/controllers/API/queries/folders";
import { useGetDownloadFolders } from "@/controllers/API/queries/folders/use-get-download-folders";
import CustomSidebarAccount from "@/customization/components/custom-sidebar-account";
import {
  ENABLE_CUSTOM_PARAM,
  ENABLE_MCP_NOTICE,
} from "@/customization/feature-flags";
import { useCustomNavigate } from "@/customization/hooks/use-custom-navigate";
import { track } from "@/customization/utils/analytics";
import { customGetDownloadFolderBlob } from "@/customization/utils/custom-get-download-folders";
import { createFileUpload } from "@/helpers/create-file-upload";
import { getObjectsFromFilelist } from "@/helpers/get-objects-from-filelist";
import useUploadFlow from "@/hooks/flows/use-upload-flow";
import { useIsMobile } from "@/hooks/use-mobile";
import { getFolderDisplayName } from "@/pages/MainPage/pages/main-page-utils";
import useAuthStore from "@/stores/authStore";
import type { FlowType } from "@/types/flow";
import type { FolderType } from "../../../../../pages/MainPage/entities";
import useAlertStore from "../../../../../stores/alertStore";
import useFlowsManagerStore from "../../../../../stores/flowsManagerStore";
import { useFolderStore } from "../../../../../stores/foldersStore";
import { useUtilityStore } from "../../../../../stores/utilityStore";
import { cn } from "../../../../../utils/utils";
import {
  isProjectScopedPath,
  resolveCurrentProjectId,
} from "../../helpers/resolve-current-project-id";
import useFileDrop from "../../hooks/use-on-file-drop";
import { SidebarFolderSkeleton } from "../sidebarFolderSkeleton";
import { BoardPickerDialog } from "./components/board-picker-dialog";
import { HeaderButtons } from "./components/header-buttons";
import { MCPServerNotice } from "./components/mcp-server-notice";
import { ProjectCreateMenu } from "./components/project-create-menu";
import { SelectOptions } from "./components/select-options";
import { useInlineProjectRename } from "./hooks/use-inline-project-rename";

type SideBarFoldersButtonsComponentProps = {
  handleChangeFolder?: (id: string) => void;
  handleDeleteFolder?: (item: FolderType) => void;
  handleFilesClick?: () => void;
};

type UploadedFlowFile = FlowType | { flows: FlowType[] };

type CreateSurface =
  | { kind: "closed" }
  | {
      kind: "board";
      projectId: string;
      projectName: string;
      trigger: HTMLButtonElement;
      continuation?: "open-add-automation";
    }
  | {
      kind: "picker";
      projectId: string;
      projectName: string;
      trigger: HTMLButtonElement;
    };

const SideBarFoldersButtonsComponent = ({
  handleChangeFolder,
  handleDeleteFolder,
  handleFilesClick,
}: SideBarFoldersButtonsComponentProps) => {
  const location = useLocation();
  const pathname = location.pathname;
  const folders = useFolderStore((state) => state.folders);
  const loading = !folders;
  const hideNewFlowButton = useUtilityStore((state) => state.hideNewFlowButton);
  const [createSurface, setCreateSurface] = useState<CreateSurface>({
    kind: "closed",
  });

  const _navigate = useCustomNavigate();

  const currentFolder = pathname.split("/");
  const urlWithoutPath =
    pathname.split("/").length < (ENABLE_CUSTOM_PARAM ? 5 : 4);
  const checkPathFiles = pathname.includes("assets");

  const checkPathName = (itemId: string) => {
    if (urlWithoutPath && itemId === myCollectionId && !checkPathFiles) {
      return true;
    }
    return currentFolder.includes(itemId);
  };

  const { t } = useTranslation();
  const setErrorData = useAlertStore((state) => state.setErrorData);
  const setSuccessData = useAlertStore((state) => state.setSuccessData);
  const isMobile = useIsMobile({ maxWidth: 1024 });
  const { setOpen } = useSidebar();
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    setOpenRef.current(!isMobile);
  }, [isMobile]);
  const folderIdDragging = useFolderStore((state) => state.folderIdDragging);
  const myCollectionId = useFolderStore((state) => state.myCollectionId);
  const takeSnapshot = useFlowsManagerStore((state) => state.takeSnapshot);

  const { folderId, projectId } = useParams<{
    folderId?: string;
    projectId?: string;
  }>();
  const resolvedProjectId = resolveCurrentProjectId({
    pathname,
    projectId,
    folderId,
    myCollectionId,
  });

  const { dragOver, dragEnter, dragLeave, onDrop } = useFileDrop(
    resolvedProjectId ?? "",
    {
      isProjectRoute: isProjectScopedPath(pathname),
      projectId: resolvedProjectId,
    },
  );
  const uploadFlow = useUploadFlow();

  const isFetchingFolders = !!useIsFetching({
    queryKey: ["useGetFolders"],
    exact: false,
  });

  const { mutate: mutateDownloadFolder } = useGetDownloadFolders({});
  const { mutate: mutateAddFolder, isPending } = usePostFolders();
  const { mutateAsync: mutateUpdateFolder } = usePatchFolders();
  const { mutate } = usePostUploadFolders();
  const {
    editingProjectId,
    draftName,
    inputRef,
    beginRename,
    setDraftName,
    commitRename,
    handleKeyDown,
  } = useInlineProjectRename({
    renameProject: async (projectIdToRename, newName) => {
      const project = folders.find((item) => item.id === projectIdToRename);
      if (!project) {
        throw new Error(`Project ${projectIdToRename} was not found`);
      }

      const updated = await mutateUpdateFolder({
        data: {
          ...project,
          name: newName,
          flows: project.flows?.map((flow) => flow.id) ?? [],
          components: project.components?.length > 0 ? project.components : [],
        },
        folderId: projectIdToRename,
      });

      return {
        id: updated.id ?? projectIdToRename,
        name: updated.name,
      };
    },
    onError: (error) => {
      setErrorData({
        title: t("projectShell.renameError"),
        list: [error instanceof Error ? error.message : String(error)],
      });
    },
  });

  const checkHoveringFolder = (folderId: string) => {
    if (folderId === folderIdDragging) {
      return "bg-accent text-accent-foreground";
    }
  };

  const isFetchingFolder = !!useIsFetching({
    queryKey: ["useGetFolder"],
    exact: false,
  });

  const isDeletingFolder = !!useIsMutating({
    mutationKey: ["useDeleteFolders"],
  });

  const isUpdatingFolder =
    isFetchingFolders ||
    isFetchingFolder ||
    isPending ||
    loading ||
    isDeletingFolder;

  const handleUploadFlowsToFolder = () => {
    createFileUpload().then((files: File[]) => {
      if (files?.length === 0) {
        return;
      }

      getObjectsFromFilelist<UploadedFlowFile>(files)
        .then((objects) => {
          if (objects.every((flow) => "data" in flow && flow.data?.nodes)) {
            uploadFlow({ files })
              .then(() => {
                setSuccessData({
                  title: t("sidebar.uploadSuccess"),
                });
              })
              .catch((error) => {
                setErrorData({
                  title: t("errors.upload"),
                  list: [
                    error instanceof Error ? error.message : String(error),
                  ],
                });
              });
          } else {
            files.forEach((folder) => {
              const formData = new FormData();
              formData.append("file", folder);
              mutate(
                { formData },
                {
                  onSuccess: () => {
                    setSuccessData({
                      title: t("sidebar.projectUploadSuccess"),
                    });
                  },
                  onError: (err) => {
                    console.error(err);
                    setErrorData({
                      title: t("sidebar.projectUploadError"),
                      list: [
                        err?.response?.data?.detail ??
                          (err instanceof Error ? err.message : String(err)),
                      ],
                    });
                  },
                },
              );
            });
          }
        })
        .catch((error) => {
          setErrorData({
            title: t("errors.upload"),
            list: [error instanceof Error ? error.message : String(error)],
          });
        });
    });
  };

  const handleDownloadFolder = (id: string, folderName: string) => {
    mutateDownloadFolder(
      {
        folderId: id,
      },
      {
        onSuccess: (response) => {
          customGetDownloadFolderBlob(response, id, folderName);
        },
        onError: (e) => {
          setErrorData({
            title: t("sidebar.downloadError"),
          });
        },
      },
    );
  };

  function addNewFolder() {
    mutateAddFolder(
      {
        data: {
          name: "New Project",
          parent_id: null,
          description: "",
        },
      },
      {
        onSuccess: (folder) => {
          track("Create New Project");
          handleChangeFolder!(folder.id);
        },
      },
    );
  }

  const handleSelectFolderToRename = (
    item: FolderType,
    triggerElement?: HTMLElement | null,
  ) => {
    if (!item.id) return;
    takeSnapshot();
    beginRename({ id: item.id, name: item.name }, triggerElement);
  };

  const handleDoubleClick = (
    event: MouseEvent<HTMLElement>,
    item: FolderType,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    handleSelectFolderToRename(item, event.currentTarget);
  };

  const [hoveredFolderId, setHoveredFolderId] = useState<string | null>(null);

  const userData = useAuthStore((state) => state.userData);
  const { mutate: updateUser } = useUpdateUser();
  const userDismissedMcpDialog = userData?.optins?.mcp_dialog_dismissed;

  const [isDismissedMcpDialog, setIsDismissedMcpDialog] = useState(
    userDismissedMcpDialog,
  );

  const handleDismissMcpDialog = () => {
    setIsDismissedMcpDialog(true);
    updateUser({
      user_id: userData?.id!,
      user: {
        optins: {
          ...userData?.optins,
          mcp_dialog_dismissed: true,
        },
      },
    });
  };

  const closeCreateSurface = () => {
    const trigger =
      createSurface.kind === "closed" ? null : createSurface.trigger;
    setCreateSurface({ kind: "closed" });
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  };

  const getProjectName = (projectIdToFind: string) => {
    const project = folders?.find(
      (candidate) => candidate.id === projectIdToFind,
    );
    return project ? getFolderDisplayName(project) : projectIdToFind;
  };

  const openBoardCreation = (
    projectIdToOpen: string,
    trigger: HTMLButtonElement,
  ) => {
    setCreateSurface({
      kind: "board",
      projectId: projectIdToOpen,
      projectName: getProjectName(projectIdToOpen),
      trigger,
    });
  };

  const openAutomationCreation = (
    projectIdToOpen: string,
    trigger: HTMLButtonElement,
  ) => {
    setCreateSurface({
      kind: "picker",
      projectId: projectIdToOpen,
      projectName: getProjectName(projectIdToOpen),
      trigger,
    });
  };

  return (
    <Sidebar
      collapsible={isMobile ? "offcanvas" : "none"}
      data-testid="project-sidebar"
    >
      <SidebarHeader className="px-4 py-1">
        <HeaderButtons
          handleUploadFlowsToFolder={handleUploadFlowsToFolder}
          isUpdatingFolder={isUpdatingFolder}
          isPending={isPending}
          addNewFolder={addNewFolder}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="p-4 py-2">
          <SidebarGroupContent>
            <SidebarMenu>
              {!loading ? (
                folders.length === 0 ? (
                  <div className="px-2 py-5 text-center text-sm text-muted-foreground">
                    {t("sidebar.emptyMessage")}
                  </div>
                ) : (
                  folders.map((item, index) => {
                    return (
                      <SidebarMenuItem
                        key={item.id ?? index}
                        className="group/menu-button"
                        onMouseEnter={() => setHoveredFolderId(item.id!)}
                        onMouseLeave={() => setHoveredFolderId(null)}
                      >
                        <div className="relative flex w-full">
                          <SidebarMenuButton
                            size="md"
                            onDragOver={(e) => dragOver(e, item.id!)}
                            onDragEnter={(e) => dragEnter(e, item.id!)}
                            onDragLeave={dragLeave}
                            onDrop={(e) => onDrop(e, item.id!)}
                            key={item.id}
                            data-testid={`sidebar-nav-${item.name}`}
                            id={`sidebar-nav-${item.name}`}
                            isActive={checkPathName(item.id!)}
                            onClick={(event) => {
                              const target = event.target;
                              if (
                                target instanceof Element &&
                                target.closest("[data-folder-options]")
                              ) {
                                return;
                              }
                              handleChangeFolder!(item.id!);
                            }}
                            onDoubleClick={(event) => {
                              handleDoubleClick(event, item);
                            }}
                            className={cn(
                              "min-w-0 flex-grow pr-[5.5rem]",
                              hoveredFolderId === item.id && "bg-accent",
                              checkHoveringFolder(item.id!),
                            )}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <div className="flex flex-1 items-center gap-2">
                                {editingProjectId === item.id &&
                                !isUpdatingFolder ? (
                                  <Input
                                    className="h-6 flex-1 text-xs focus:border-0"
                                    onChange={(event) =>
                                      setDraftName(event.target.value)
                                    }
                                    maxLength={38}
                                    ref={inputRef}
                                    onKeyDown={handleKeyDown}
                                    autoFocus
                                    onBlur={() => {
                                      void commitRename();
                                    }}
                                    value={draftName}
                                    id={`input-project-${item.name}`}
                                    data-testid="input-project"
                                  />
                                ) : (
                                  <span className="block w-0 grow truncate text-sm opacity-100">
                                    {getFolderDisplayName(item)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </SidebarMenuButton>
                          <div
                            data-folder-options
                            className="absolute right-1 top-0 flex items-center hover:text-foreground"
                          >
                            {!hideNewFlowButton && item.id ? (
                              <ProjectCreateMenu
                                project={{
                                  id: item.id,
                                  name: getFolderDisplayName(item),
                                }}
                                onCreateBoard={openBoardCreation}
                                onCreateAutomation={openAutomationCreation}
                              />
                            ) : null}
                            <SelectOptions
                              item={item}
                              handleDeleteFolder={handleDeleteFolder}
                              handleDownloadFolder={() =>
                                handleDownloadFolder(item.id!, item.name)
                              }
                              handleSelectFolderToRename={(folder) => {
                                const triggerElement = document.getElementById(
                                  `options-trigger-${folder.name}`,
                                );
                                window.setTimeout(
                                  () =>
                                    handleSelectFolderToRename(
                                      folder,
                                      triggerElement,
                                    ),
                                  0,
                                );
                              }}
                              checkPathName={checkPathName}
                            />
                          </div>
                        </div>
                      </SidebarMenuItem>
                    );
                  })
                )
              ) : (
                <>
                  <SidebarFolderSkeleton />
                  <SidebarFolderSkeleton />
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="flex-1" />

        {ENABLE_MCP_NOTICE && !isDismissedMcpDialog && (
          <div className="p-2">
            <MCPServerNotice handleDismissDialog={handleDismissMcpDialog} />
          </div>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t">
        <div className="p-2">
          <CustomSidebarAccount />
        </div>
      </SidebarFooter>
      {createSurface.kind === "picker" ? (
        <BoardPickerDialog
          open
          projectId={createSurface.projectId}
          projectName={createSurface.projectName}
          onOpenChange={(open) => {
            if (!open) closeCreateSurface();
          }}
          onSelectBoard={(boardId) => {
            const projectIdToOpen = createSurface.projectId;
            setCreateSurface({ kind: "closed" });
            _navigate(
              `/project/${projectIdToOpen}/board/${boardId}?open-add-automation=1`,
            );
          }}
          onCreateBoard={() => {
            setCreateSurface({
              kind: "board",
              projectId: createSurface.projectId,
              projectName: createSurface.projectName,
              trigger: createSurface.trigger,
              continuation: "open-add-automation",
            });
          }}
        />
      ) : null}
      {createSurface.kind === "board" ? (
        <BoardCreationDialog
          open
          projectId={createSurface.projectId}
          continuation={createSurface.continuation}
          onOpenChange={(open) => {
            if (!open) closeCreateSurface();
          }}
        />
      ) : null}
    </Sidebar>
  );
};
export default SideBarFoldersButtonsComponent;
