import axios, { AxiosInstance, AxiosError } from 'axios';

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private provider: string;

  constructor(baseUrl: string, apiKey: string, provider: string = 'default') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.provider = provider;
    
    this.client = axios.create({
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 404) {
          console.error(`404 Error: Request URL was ${error.config?.url}`);
        }
        return Promise.reject(error);
      }
    );
  }

  async post<T>(path: string, data: unknown): Promise<T> {
    const url = this.buildUrl(path);
    const response = await this.client.post<T>(url, data);
    return response.data;
  }

  private buildUrl(path: string): string {
    let normalizedPath = path.startsWith('/') ? path : `/${path}`;
    
    if (this.provider === 'alibaba' && !normalizedPath.startsWith('/v1/')) {
      normalizedPath = `/v1${normalizedPath}`;
    }
    
    return new URL(normalizedPath, this.baseUrl).toString();
  }
}
