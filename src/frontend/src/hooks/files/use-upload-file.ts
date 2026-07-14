import { useTranslation } from "react-i18next";
import { customPostUploadFileV2 } from "@/customization/hooks/use-custom-post-upload-file";
import { createFileUpload } from "@/helpers/create-file-upload";
import useFileSizeValidator from "@/shared/hooks/use-file-size-validator";
import {
  getRelativePathForServerPath,
  setRelativePathForServerPath,
} from "@/utils/file-relative-path-map";
import { getLocalizedApiErrorMessage } from "@/utils/localized-api-error";

const useUploadFile = ({
  types,
  multiple,
  webkitdirectory,
}: {
  types?: string[];
  multiple?: boolean;
  webkitdirectory?: boolean;
}) => {
  const { t } = useTranslation();
  const { mutateAsync: uploadFileMutation } = customPostUploadFileV2();
  const { validateFileSize } = useFileSizeValidator();

  const getFilesToUpload = async ({
    files,
  }: {
    files?: File[];
  }): Promise<File[]> => {
    if (!files) {
      files = await createFileUpload({
        accept: types?.map((type) => `.${type}`).join(",") ?? "",
        multiple: multiple ?? false,
        webkitdirectory: webkitdirectory ?? false,
      });
    }
    return files;
  };

  const uploadFile = async ({
    files,
  }: {
    files?: File[];
  }): Promise<string[]> => {
    try {
      const filesToUpload = await getFilesToUpload({ files });
      const filesIds: string[] = [];

      // Filter files by supported types when using folder selection
      let validFiles = filesToUpload;
      if (webkitdirectory && types) {
        validFiles = filesToUpload.filter((file) => {
          const fileExtension = file.name.split(".").pop()?.toLowerCase();
          return fileExtension && types.includes(fileExtension);
        });

        if (validFiles.length === 0) {
          throw new Error(
            t("files.noSupportedInFolder", {
              allowedTypes: types?.join(", ") ?? "",
            }),
          );
        }
      }

      for (const file of validFiles) {
        validateFileSize(file);
        // Check if file extension is allowed (for non-folder selection)
        if (!webkitdirectory) {
          const fileExtension = file.name.split(".").pop()?.toLowerCase();
          if (!fileExtension || (types && !types.includes(fileExtension))) {
            throw new Error(
              t("files.typeNotAllowed", {
                type: fileExtension ?? "",
                allowedTypes: types?.join(", ") ?? "",
              }),
            );
          }
          if (!multiple && filesToUpload.length !== 1) {
            throw new Error(t("files.multipleNotAllowed"));
          }
        }

        let res: Awaited<ReturnType<typeof uploadFileMutation>>;
        try {
          res = await uploadFileMutation({ file });
        } catch (error: unknown) {
          throw new Error(
            getLocalizedApiErrorMessage(
              error,
              (key, params) => t(key, params),
              { fallbackKey: "errors.requestFailed" },
            ),
          );
        }

        if (!webkitdirectory && res?.path) {
          const existing = getRelativePathForServerPath(res.path);
          if (existing && existing.includes("/")) {
            const flatName = String(res.path).split("/").filter(Boolean).pop();
            setRelativePathForServerPath(
              res.path,
              flatName ?? String(res.path),
            );
          }
        }

        if (webkitdirectory && file.webkitRelativePath) {
          const relativeParts = file.webkitRelativePath
            .split("/")
            .filter(Boolean);
          const serverLeaf = String(res.path ?? "")
            .split("/")
            .filter(Boolean)
            .pop();
          if (relativeParts.length > 0 && serverLeaf) {
            relativeParts[relativeParts.length - 1] = serverLeaf;
            setRelativePathForServerPath(res.path, relativeParts.join("/"));
          } else {
            setRelativePathForServerPath(res.path, file.webkitRelativePath);
          }
        }
        filesIds.push(res.path);
      }
      return filesIds;
    } catch (error: unknown) {
      if (error instanceof Error) throw error;
      throw new Error(t("errors.requestFailed"));
    }
  };

  return uploadFile;
};

export default useUploadFile;
