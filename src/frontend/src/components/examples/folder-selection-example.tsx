import { useState } from "react";
import { useTranslation } from "react-i18next";
import InputFileComponent from "@/components/core/parameterRenderComponent/components/inputFileComponent";

type FolderSelectionData = {
  value?: string;
  file_path?: string;
};

/**
 * Example component demonstrating the folder selection functionality
 * in the InputFileComponent. This shows how to enable folder selection
 * which allows users to select entire folders and recursively process
 * all supported files within them.
 */
export default function FolderSelectionExample() {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>("");
  const [filePath, setFilePath] = useState<string>("");

  const handleOnNewValue = (data: Partial<FolderSelectionData>) => {
    setValue(data.value ?? "");
    setFilePath(data.file_path ?? "");
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">
          {t("folderSelectionExample.title")}
        </h2>
        <p className="text-muted-foreground mb-6">
          {t("folderSelectionExample.description")}
        </p>
        <ul className="list-disc list-inside text-sm text-muted-foreground mb-6 space-y-1">
          <li>
            <strong>{t("folderSelectionExample.filesModeLabel")}</strong>{" "}
            {t("folderSelectionExample.filesModeDescription")}
          </li>
          <li>
            <strong>{t("folderSelectionExample.folderModeLabel")}</strong>{" "}
            {t("folderSelectionExample.folderModeDescription")}
          </li>
          <li>{t("folderSelectionExample.matchingTypesOnly")}</li>
          <li>{t("folderSelectionExample.supportedFormats")}</li>
        </ul>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">
            {t("folderSelectionExample.componentLabel")}
          </label>
          <InputFileComponent
            value={value}
            file_path={filePath}
            handleOnNewValue={handleOnNewValue}
            disabled={false}
            fileTypes={[
              "pdf",
              "txt",
              "doc",
              "docx",
              "md",
              "rtf",
              "csv",
              "json",
            ]}
            isList={true}
            tempFile={true}
            editNode={false}
            id="folder-example"
            allowFolderSelection={true}
          />
        </div>

        {(value || filePath) && (
          <div className="p-4 bg-muted rounded-lg">
            <h3 className="font-medium mb-2">
              {t("folderSelectionExample.selectedFiles")}
            </h3>
            <div className="space-y-1 text-sm">
              <div>
                <strong>{t("folderSelectionExample.valueLabel")}</strong>{" "}
                {value}
              </div>
              <div>
                <strong>{t("folderSelectionExample.filePathLabel")}</strong>{" "}
                {filePath}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t pt-6">
        <h3 className="font-medium mb-2">
          {t("folderSelectionExample.usageInstructions")}
        </h3>
        <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
          <li>{t("folderSelectionExample.enableFolderMode")}</li>
          <li>{t("folderSelectionExample.selectFolder")}</li>
          <li>{t("folderSelectionExample.recursiveDiscovery")}</li>
          <li>{t("folderSelectionExample.processMatchingTypes")}</li>
          <li>{t("folderSelectionExample.uploadResult")}</li>
        </ol>
      </div>
    </div>
  );
}
