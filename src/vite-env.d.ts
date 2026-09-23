/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FUNCTIONS_REGION?: string;
  readonly VITE_USE_EMULATORS?: string;
  /** PPE inference service base URL, e.g. http://127.0.0.1:8765 */
  readonly VITE_PPE_INFERENCE_URL?: string;
  readonly VITE_PPE_INFERENCE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
