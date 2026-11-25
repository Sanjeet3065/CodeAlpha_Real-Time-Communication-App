/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_LIVEKIT_WS_URL: string;
  readonly VITE_SOCKET_IO_URL: string;
  readonly VITE_ENABLE_VIRTUAL_BACKGROUND: string;
  readonly VITE_ENABLE_WHITEBOARD: string;
  readonly VITE_ENABLE_FILE_SHARING: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
