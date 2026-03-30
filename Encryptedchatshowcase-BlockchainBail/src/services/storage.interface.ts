/**
 * ochat-storage.interface.ts
 *
 * Interface for the local storage layer used by OChat.tsx.
 * Implement against localStorage, IndexedDB, or your preferred store.
 */

export interface CachedConversation {
  id: string;
  peerAddress: string;
  lastMessage?: string;
  lastMessageAt?: number;
}

export declare function getChatNickname(address: string): string | null;
export declare function setChatNickname(address: string, nickname: string): void;
export declare function getAllNicknames(): Record<string, string>;

export declare function getInboxAddress(inboxId: string): string | null;
export declare function setInboxAddress(inboxId: string, address: string): void;
export declare function getAllInboxMap(): Record<string, string>;

export declare function getCachedConversations(walletAddress: string): CachedConversation[];
export declare function setCachedConversations(walletAddress: string, convos: CachedConversation[]): void;


/**
 * profile-storage.interface.ts
 *
 * Interface for reading the user's own profile (display name, avatar).
 */

export interface UserProfile {
  displayName?: string;
  avatarUrl?: string;
}

export declare function getProfile(address: string): UserProfile | null;
