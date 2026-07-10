export interface SeedAuthRuntime {
  password: string;
  shouldLogPassword: boolean;
}

export function resolveSeedAuthRuntime(
  env: Readonly<Record<string, string | undefined>>,
  developmentDefaultPassword: string
): SeedAuthRuntime {
  const configuredPassword = env.SEED_PASSWORD;
  if (configuredPassword) {
    return { password: configuredPassword, shouldLogPassword: false };
  }
  return {
    password: developmentDefaultPassword,
    shouldLogPassword: true
  };
}

export function seedAuthLogLines(runtime: SeedAuthRuntime, accountSummary: string): string[] {
  return [
    ...(runtime.shouldLogPassword
      ? [`Auth seed accounts password: ${runtime.password}`]
      : []),
    `Auth seed accounts: ${accountSummary}`
  ];
}
