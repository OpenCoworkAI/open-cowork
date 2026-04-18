export const ALIBABA_CLOUD_CONFIG = {
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
} as const;

export type AlibabaCloudConfig = typeof ALIBABA_CLOUD_CONFIG;