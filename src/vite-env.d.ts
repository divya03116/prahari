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
  /** Callables served from a path on this site, or another URL, instead of Cloud Functions — e.g. /api/fn */
  readonly VITE_FUNCTIONS_ORIGIN?: string;
  /** 'off' when the project has no Cloud Storage bucket. */
  readonly VITE_UPLOADS?: string;
  /** PPE inference service base URL, e.g. http://127.0.0.1:8765 */
  readonly VITE_PPE_INFERENCE_URL?: string;
  readonly VITE_PPE_INFERENCE_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
