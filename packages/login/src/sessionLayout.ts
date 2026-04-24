export interface SessionLocation {
  pathName: string;
  searchParams: Record<string, string>;
}

export interface BaseSessionLayout {
  id: string;
  token: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
  avatarFallback?: string | null;
  admin?: boolean | null;
  language?: string | null;
  location?: SessionLocation;
  roomCodes?: string[];
}

export interface AuthProps {
  /** If true, user must have a valid session with an ID */
  login: boolean;

  /** Additional validation rules for session properties */
  additional?: {
    /** The session property to check (e.g., 'admin', 'email') */
    key: keyof BaseSessionLayout;

    /** Exact value the property must equal (strict comparison) */
    value?: unknown;

    /** Type the property must be */
    type?: 'string' | 'number' | 'boolean';

    /** If true, property must be null/undefined. If false, must NOT be null/undefined */
    nullish?: boolean;

    /** If true, property must be falsy. If false, must be truthy */
    mustBeFalsy?: boolean;
  }[];
}
