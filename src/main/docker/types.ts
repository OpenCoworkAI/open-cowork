export interface ContainerInfo {
  name: string;
  id: string;
  status: 'not_found' | 'created' | 'running' | 'paused' | 'exited' | 'removing';
  image: string;
  startedAt?: string;
  ports?: string;
}

export interface PullProgress {
  status: string;
  progress?: string;
  percent: number; // -1 if unknown
}

export interface CareerBoxConfig {
  containerName: string;       // default: 'coeadapt-workspace'
  imageName: string;           // default: 'coeadapt/career-box:latest'
  volumeName: string;          // default: 'coeadapt-data'
  port: number;                // default: 3001
  memoryMb: number;            // default: 2048
  password: string;            // default: 'coeadapt'
}
