export interface SyntheticSignatureDatabaseConfig {
  url?: string;
  container?: string;
  runId?: string;
}

export function assertSyntheticSignatureDatabase(
  config: SyntheticSignatureDatabaseConfig,
  run?: (command: string, args: string[], options: unknown) => string
): void;
