export type AppleFullName = {
  namePrefix?: string;
  givenName?: string;
  middleName?: string;
  familyName?: string;
  nameSuffix?: string;
  nickname?: string;
  formatted?: string;
};

export type AppleAuthorizeResult =
  | {
      status: 'success';
      identityToken: string;
      authorizationCode: string;
      /** Stable Apple subject for this developer team. It is not a Supabase user id. */
      userId: string;
      /** Present only when AuthenticationServices supplies it, normally first authorization. */
      fullName: AppleFullName | null;
      /** Exact opaque state returned by AuthenticationServices. */
      state: string;
    }
  | {
      status: 'cancelled';
      /** The request state retained by the native single-flight operation. */
      state: string;
    };

export type AppleCredentialState =
  | 'authorized'
  | 'revoked'
  | 'not_found'
  | 'transferred'
  | 'unknown';

export type AppleCredentialStateResult = {
  state: AppleCredentialState;
};

export interface AppleAuthPlugin {
  /** Receives a SHA-256 nonce challenge. The raw nonce must never cross this bridge. */
  authorize(options: {
    hashedNonce: string;
    state: string;
  }): Promise<AppleAuthorizeResult>;

  getCredentialState(options: {
    userId: string;
  }): Promise<AppleCredentialStateResult>;
}
