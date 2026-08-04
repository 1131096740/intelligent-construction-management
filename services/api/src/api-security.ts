interface ExpressSecurityApplication {
  getHttpAdapter(): {
    getInstance(): {
      disable(setting: string): unknown;
    };
  };
}

export function configureApiSecurity(app: ExpressSecurityApplication) {
  app.getHttpAdapter().getInstance().disable("x-powered-by");
}
