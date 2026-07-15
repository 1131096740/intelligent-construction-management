export interface AuthenticatedUser {
  id: string;
  name: string;
  phone: string | null;
}

export interface AuthenticatedRequest {
  user?: AuthenticatedUser;
  params?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;
  name?: string;
  phone?: string | null;
  type: "access" | "refresh";
  jti?: string;
  iat: number;
  exp: number;
}
