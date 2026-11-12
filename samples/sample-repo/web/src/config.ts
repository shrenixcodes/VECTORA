/** Runtime configuration for the web application. */
export interface AppConfig {
  port: number;
  sessionTtlMinutes: number;
}

export const DEFAULT_PORT = 3000;

export function loadConfig(): AppConfig {
  return { port: DEFAULT_PORT, sessionTtlMinutes: 30 };
}
