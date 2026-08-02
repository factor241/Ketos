import Dropdown from "../../../dropdownComponent";
import type { DropDownComponentType, InputProps } from "../../types";
import ToggleShadComponent from "../toggleShadComponent";

export default function DropdownComponent({
  id,
  value,
  editNode,
  handleOnNewValue,
  disabled,
  combobox,
  options,
  name,
  dialogInputs,
  externalOptions,
  optionsMetaData,
  placeholder,
  nodeClass,
  nodeId,
  handleNodeClass,
  toggle,
  toggleValue,
  toggleDisable,
  hasRefreshButton,
  showParameter = true,
  ...baseInputProps
}: InputProps<string, DropDownComponentType>): JSX.Element | null {
  const onChange = (
    value: unknown,
    dbValue?: boolean,
    skipSnapshot?: boolean,
    selectedMetadata?: unknown,
  ) => {
    const changes: Record<string, unknown> = {
      value,
      load_from_db: dbValue,
    };
    // If metadata provided, include it as selected_metadata
    if (selectedMetadata !== undefined) {
      changes.selected_metadata = selectedMetadata;
    }
    handleOnNewValue(changes, { skipSnapshot });
  };

  if (!showParameter) {
    return null;
  }

  const nodeContextProps =
    nodeId && nodeClass
      ? { nodeId, nodeClass, handleNodeClass, handleOnNewValue }
      : {};

  return (
    <div className="flex w-full items-center gap-4">
      <Dropdown
        disabled={disabled || toggleValue === false}
        editNode={editNode}
        toggle={toggle}
        options={options}
        {...nodeContextProps}
        optionsMetaData={optionsMetaData}
        onSelect={onChange}
        placeholder={placeholder}
        combobox={combobox}
        value={value || (toggleValue === false && toggle ? options[0] : "")}
        id={`dropdown_${id}`}
        name={name}
        dialogInputs={dialogInputs}
        externalOptions={externalOptions}
        handleOnNewValue={handleOnNewValue}
        hasRefreshButton={hasRefreshButton}
        {...baseInputProps}
      />
      {toggle && toggleDisable !== true ? (
        <ToggleShadComponent
          value={toggleValue ?? true}
          handleOnNewValue={(data) => {
            handleOnNewValue({
              value: data.value === true ? options[0] : null,
              toggle_value: data.value,
            });
          }}
          editNode={editNode}
          id={`toggle_dropdown_${id}`}
          disabled={disabled}
        />
      ) : (
        <></>
      )}
    </div>
  );
}
