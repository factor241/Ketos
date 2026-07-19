import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import CopilotKitInterruptProbe from "./copilotkit-interrupt-probe";

export function CopilotKitProbe() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit">
      <CopilotKitInterruptProbe />
      <CopilotChat agentId="ketos-mvp-probe" />
    </CopilotKitProvider>
  );
}

export default CopilotKitProbe;
