/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// React 19 compatibility - JSX namespace is now exported from React
declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface ElementClass extends React.JSX.ElementClass {}
    interface ElementAttributesProperty
      extends React.JSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute
      extends React.JSX.ElementChildrenAttribute {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T>
      extends React.JSX.IntrinsicClassAttributes<T> {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }

  interface ImportMetaEnv {
    readonly BACKEND_URL: string;
    readonly ACCESS_TOKEN_EXPIRE_SECONDS: string;
    readonly CI: string;
    readonly KETOS_AUTO_LOGIN: string;
    readonly KETOS_MCP_COMPOSER_ENABLED: string;
    readonly KETOS_EXTENSION_RELOAD_ENABLED?: string;
    readonly KETOS_WXO_UTM_SOURCE?: string;
    readonly VITE_ENABLE_RUSSIAN_LOCALE?: string;
    readonly VITE_STRICT_RU_I18N?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __KETOS_I18N_DIAGNOSTICS__?: import("./i18n-diagnostics").I18nDiagnostics;
  }
}

declare module "*.svg" {
  const content: string;
  export default content;
}

export {};
