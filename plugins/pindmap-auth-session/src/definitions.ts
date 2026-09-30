export type MirrorSessionOptions = {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds (Supabase session.expires_at) */
  expiresAt: number | null;
  userId: string;
};

export interface PindmapAuthSessionPlugin {
  /**
   * Write tokens to Shared Keychain + userId to App Group UserDefaults.
   * No-op on web / when native plugin is absent.
   */
  mirrorSession(options: MirrorSessionOptions): Promise<void>;
  /** Clear Keychain tokens + App Group userId (logout). */
  clearSession(): Promise<void>;
}
