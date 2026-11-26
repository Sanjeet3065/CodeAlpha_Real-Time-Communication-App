export interface CspConfigInput {
  NODE_ENV: string;
  CLIENT_ORIGIN?: string;
  LIVEKIT_URL?: string;
  LIVEKIT_PUBLIC_URL?: string;
  SUPABASE_URL?: string;
  STORAGE_PROVIDER?: string;
  STORAGE_S3_ENDPOINT?: string;
  STORAGE_S3_BUCKET?: string;
  STORAGE_S3_REGION?: string;
}
