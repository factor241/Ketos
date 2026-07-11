import { createContext, type ReactNode, useContext } from "react";

const CanvasReadOnlyContext = createContext(false);

export function CanvasReadOnlyProvider({
  children,
  readOnly,
}: {
  children: ReactNode;
  readOnly: boolean;
}) {
  return (
    <CanvasReadOnlyContext.Provider value={readOnly}>
      {children}
    </CanvasReadOnlyContext.Provider>
  );
}

export function useCanvasReadOnly(): boolean {
  return useContext(CanvasReadOnlyContext);
}
