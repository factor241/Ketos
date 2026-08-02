import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs-button";
import { getOptionLabel } from "@/utils/option-presentation";
import { testIdCase } from "@/utils/utils";
import type { InputProps, TabComponentType } from "../../types";

export default function TabComponent({
  id,
  value,
  editNode,
  handleOnNewValue,
  disabled,
  options = [],
  optionsMetaData = [],
  showParameter = true,
  ...baseInputProps
}: InputProps<string, TabComponentType>): JSX.Element | null {
  const [activeTab, setActiveTab] = useState<string>(value || "");

  // Update the active tab when the component props change
  useEffect(() => {
    if (options.length > 0) {
      // If value is one of the options, use it
      if (value && options.includes(value)) {
        setActiveTab(value);
      }
    }
  }, [options, value]);

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    handleOnNewValue({ value }, {});
  };

  // Limit the number of tabs, but never alter their machine values.
  const validOptions = options.slice(0, 3).map((value) => ({
    value,
    label: getOptionLabel(value, options, optionsMetaData),
  }));

  if (!showParameter) {
    return null;
  }

  return (
    <div className="w-full">
      <Tabs
        defaultValue={activeTab}
        value={activeTab}
        onValueChange={handleTabChange}
        className={`w-full ${disabled ? "pointer-events-none opacity-70" : ""}`}
      >
        <TabsList className="w-full">
          {validOptions.map((tab, index) => (
            <TabsTrigger
              key={`${id}_tab_${index}`}
              value={tab.value}
              className="block flex-1 truncate px-2"
              disabled={disabled}
              data-testid={`tab_${index}_${testIdCase(tab.value)}`}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
