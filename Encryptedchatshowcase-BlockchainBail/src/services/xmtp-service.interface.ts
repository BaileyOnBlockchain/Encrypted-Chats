/**
 * xmtp-service.interface.ts
 *
 * Interface contract for the XMTP service layer used by OChat.tsx and OChatRooms.tsx.
 * Implement these against @xmtp/browser-sdk or your preferred XMTP client.
 *
 * Full implementation lives inside the Oden Network XR dapp.
 * Live: https://oden-net-work.vercel.app
 */

export interface XmtpMessage {
  id: string;
  senderInboxId: string;
  content: string;
  sentAtNs: bigint;
}

// ─── Error sentinels ──────────────────────────────────────────────────────────
export const XMTP_INSTALLATION_LIMIT = 'XMTP_INSTALLATION_LIMIT';
export const XMTP_IDENTITY_UNINITIALIZED = 'XMTP_IDENTITY_UNINITIALIZED';

/** Broadcast to all group members before destroying a room */
export const NUKE_SIGNAL = 'OCHAT_NUKE_SIGNAL';

// ─── Client lifecycle ─────────────────────────────────────────────────────────

/** Initialise XMTP client from a wagmi WalletClient. Signs identity on first use. */
export declare function initXmtp(walletClient: unknown): Promise<void>;

/** Returns the active XMTP client, or null if not initialised. */
export declare function getXmtpClient(): unknown | null;

/** Disconnect and clear the active XMTP client. */
export declare function disconnectXmtp(): void;

/**
 * Revoke all other XMTP installations for this wallet, then reconnect.
 * Called when XMTP_INSTALLATION_LIMIT is hit.
 */
export declare function revokeOtherInstallationsAndConnect(walletClient: unknown): Promise<void>;

// ─── DM conversations ─────────────────────────────────────────────────────────

/** Check whether a wallet address has an XMTP identity. */
export declare function canMessage(address: string): Promise<boolean>;

/** Open or retrieve an existing DM conversation with a peer address. */
export declare function startConversation(address: string): Promise<unknown>;

/** List all DM conversations for the current client. */
export declare function getConversations(): Promise<unknown[]>;

/** Fetch messages for a conversation (network). */
export declare function getMessages(conversation: unknown): Promise<XmtpMessage[]>;

/** Fetch messages from local cache (fast, no network). */
export declare function getMessagesLocal(conversation: unknown): Promise<XmtpMessage[]>;

/** Send a text message into a conversation. */
export declare function sendMessage(conversation: unknown, content: string): Promise<void>;

/** Send an image attachment. content should be a base64-encoded string. */
export declare function sendImageAttachment(conversation: unknown, file: File): Promise<void>;

/**
 * Stream incoming messages for a conversation.
 * Returns a cleanup function — call it to stop the stream.
 */
export declare function streamMessages(
  conversation: unknown,
  onMessage: (msg: XmtpMessage) => void
): Promise<() => void>;

/** Hide/archive a conversation (local only, not deleted from XMTP). */
export declare function hideConversation(conversation: unknown): Promise<void>;

// ─── Group rooms ──────────────────────────────────────────────────────────────

/** Create a new XMTP group with optional initial members. */
export declare function createGroup(name: string, memberAddresses?: string[]): Promise<unknown>;

/** List all groups the current client is a member of. */
export declare function getGroups(): Promise<unknown[]>;

/** Add a wallet address to an existing group. */
export declare function addGroupMember(group: unknown, address: string): Promise<void>;

/** Accept a pending group invitation. */
export declare function acceptGroupInvite(group: unknown): Promise<void>;

/** Decline a pending group invitation. */
export declare function declineGroupInvite(group: unknown): Promise<void>;

/** Send a text message into a group. */
export declare function sendGroupMessage(group: unknown, content: string): Promise<void>;

/** Fetch group messages (network). */
export declare function getGroupMessages(group: unknown): Promise<XmtpMessage[]>;

/** Fetch group messages from local cache. */
export declare function getGroupMessagesLocal(group: unknown): Promise<XmtpMessage[]>;

/**
 * Stream incoming group messages.
 * Returns a cleanup function.
 */
export declare function streamGroupMessages(
  group: unknown,
  onMessage: (msg: XmtpMessage) => void
): Promise<() => void>;

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Resolve XMTP inbox IDs to wallet addresses.
 * Returns a map of inboxId → address.
 */
export declare function resolveInboxAddresses(inboxIds: string[]): Promise<Record<string, string>>;
