'use client';

/**
 * OChat.tsx — Encrypted P2P Messaging Component
 *
 * Powers the O-Chat messaging module of Oden Network XR.
 * Built on the XMTP protocol with wallet-signed identity and E2EE by default.
 *
 * Live: https://oden-net-work.vercel.app
 * Built by @blockchainbail — https://x.com/blockchainbail
 *
 * Internal service imports have been replaced with generic paths.
 * See src/services/ for interface contracts.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';

// ── UI primitives — replace with your own components ──────────────────────────
// GlassCard: a frosted-glass container with backdrop-filter blur
// ConnectWalletCard: a prompt shown to unauthenticated users to connect wallet
import { GlassCard } from './ui/GlassCard';
import { ConnectWalletCard } from './ui/ConnectWalletCard';

// ── Lucide icons ───────────────────────────────────────────────────────────────
import {
  MessageCircle, Send, Lock, Shield, Zap, Sparkles, Search,
  Plus, Check, CheckCheck, X, LogOut, Loader2, ArrowLeft, PencilLine, ImagePlus, Clock
} from 'lucide-react';

// ── XMTP service layer — see src/services/xmtp-service.interface.ts ───────────
import {
  initXmtp,
  canMessage,
  startConversation,
  getConversations,
  sendMessage,
  getMessages,
  getMessagesLocal,
  streamMessages,
  getXmtpClient,
  disconnectXmtp,
  revokeOtherInstallationsAndConnect,
  resolveInboxAddresses,
  XMTP_INSTALLATION_LIMIT,
  XMTP_IDENTITY_UNINITIALIZED,
  hideConversation,
  sendImageAttachment,
  type XmtpMessage,
} from './services/xmtp-service';

// ── Storage layer — see src/services/storage.interface.ts ─────────────────────
import {
  getChatNickname,
  setChatNickname,
  getAllNicknames,
  getInboxAddress,
  setInboxAddress,
  getAllInboxMap,
  getCachedConversations,
  setCachedConversations,
  type CachedConversation,
} from './services/ochat-storage';

// ── Profile storage — see src/services/storage.interface.ts ───────────────────
import { getProfile } from './services/profile-storage';

// ── Inline util ───────────────────────────────────────────────────────────────
const shortenAddress = (addr: string) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';


// ─────────────────────────────────────────────────────────────────────────────
// Custom nuclear hazard icon (trefoil SVG)
// Used for the "nuke conversation" action — wipes the chat for both parties
// ─────────────────────────────────────────────────────────────────────────────
const NukeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="12" cy="12" r="2.4" />
    {/* Top blade */}
    <path d="M10.25 8.97 A3.5 3.5 0 0 1 13.75 8.97 L16.5 4.21 A9 9 0 0 0 7.5 4.21 Z" />
    {/* Lower-right blade */}
    <path d="M15.5 12 A3.5 3.5 0 0 1 13.75 15.03 L16.5 19.79 A9 9 0 0 0 21 12 Z" />
    {/* Lower-left blade */}
    <path d="M10.25 15.03 A3.5 3.5 0 0 1 8.5 12 L3 12 A9 9 0 0 0 7.5 19.79 Z" />
  </svg>
);


// ─────────────────────────────────────────────────────────────────────────────
// Image compression utility
// Draws the image to a canvas and iteratively reduces JPEG quality
// until the file fits under the XMTP attachment size limit.
// ─────────────────────────────────────────────────────────────────────────────
async function compressImage(file: File, maxBytes: number): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    const cleanup = () => { try { URL.revokeObjectURL(blobUrl); } catch {} };
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { cleanup(); resolve(file); return; }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.8;
        const tryCompress = () => {
          canvas.toBlob(
            (blob) => {
              if (!blob) { cleanup(); resolve(file); return; }
              if (blob.size <= maxBytes || quality <= 0.1) {
                cleanup();
                resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
              } else {
                quality -= 0.15;
                tryCompress();
              }
            },
            'image/jpeg',
            quality
          );
        };
        tryCompress();
      } catch {
        cleanup();
        resolve(file);
      }
    };
    img.onerror = () => { cleanup(); reject(new Error('Failed to load image for compression')); };
    img.src = blobUrl;
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Control message system
//
// O-Chat uses the XMTP message stream for three types of control messages
// in addition to regular text/image content. These are JSON payloads that
// are filtered out before render.
//
//   OCHAT_NUKE      — wipes the conversation for both parties
//   OCHAT_PRESENCE  — heartbeat; drives the online/offline indicator
//   OCHAT_DELIVERED — delivery receipt (batched, debounced)
// ─────────────────────────────────────────────────────────────────────────────
const NUKE_TYPE = 'OCHAT_NUKE';
const PRESENCE_TYPE = 'OCHAT_PRESENCE';
const DELIVERY_TYPE = 'OCHAT_DELIVERED';

const isNukeMessage = (content: string): boolean => {
  if (!content || !content.startsWith('{')) return false;
  try { return JSON.parse(content)?.type === NUKE_TYPE; } catch { return false; }
};
const isPresenceMessage = (content: string): boolean => {
  if (!content || !content.startsWith('{')) return false;
  try { return JSON.parse(content)?.type === PRESENCE_TYPE; } catch { return false; }
};
const isDeliveryMessage = (content: string): boolean => {
  if (!content || !content.startsWith('{')) return false;
  try { return JSON.parse(content)?.type === DELIVERY_TYPE; } catch { return false; }
};
const isControlMessage = (content: string): boolean =>
  isNukeMessage(content) || isPresenceMessage(content) || isDeliveryMessage(content);


// ─────────────────────────────────────────────────────────────────────────────
// Decrypt animation
//
// New messages arrive as scrambled characters that resolve left-to-right,
// mimicking a live decryption effect. Duration scales with message length.
// Only newly arrived messages animate — history renders immediately.
// ─────────────────────────────────────────────────────────────────────────────
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*<>{}[]';
function genScramble(len: number): string {
  if (len <= 0) return '';
  return Array.from({ length: len }, () =>
    SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
  ).join('');
}

function DecryptText({ text, shouldAnimate }: { text: string; shouldAnimate: boolean }) {
  const [resolved, setResolved] = useState(shouldAnimate ? '' : text);
  const [scramble, setScramble] = useState(shouldAnimate ? genScramble(text.length) : '');
  const [done, setDone] = useState(!shouldAnimate);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!shouldAnimate) return;
    const duration = Math.min(1400, 550 + text.length * 38);
    const startTime = performance.now();
    const animate = (now: number) => {
      const prog = Math.min((now - startTime) / duration, 1);
      const resolvedCount = Math.floor(Math.pow(prog, 0.75) * text.length);
      setResolved(text.slice(0, resolvedCount));
      setScramble(genScramble(text.length - resolvedCount));
      if (prog >= 1) { setDone(true); } else { rafRef.current = requestAnimationFrame(animate); }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [text, shouldAnimate]);

  if (done) return <>{text}</>;
  return (
    <span className="font-mono">
      <span>{resolved}</span>
      <span className="text-green-400/70">{scramble}</span>
    </span>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Online presence indicator
// SVG: two user silhouettes with a neon connection link between them.
// Both green = both online. Dashed grey = peer offline.
// ─────────────────────────────────────────────────────────────────────────────
const OnlineIndicator = ({ selfOnline, peerOnline }: { selfOnline: boolean; peerOnline: boolean }) => (
  <div className="flex items-center" title={peerOnline ? 'Both users online' : 'Peer offline'}>
    <svg viewBox="0 0 56 24" className="w-12 h-5">
      <defs>
        <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={selfOnline ? 'url(#neonGlow)' : undefined}>
        <circle cx="10" cy="9" r="4" fill={selfOnline ? '#39FF14' : '#555'} opacity={selfOnline ? 0.9 : 0.3} />
        <path d="M4 20 Q10 14 16 20" fill={selfOnline ? '#39FF14' : '#555'} opacity={selfOnline ? 0.6 : 0.2} />
      </g>
      <line x1="18" y1="12" x2="38" y2="12"
        stroke={selfOnline && peerOnline ? '#39FF14' : '#555'}
        strokeWidth="1.5"
        strokeDasharray={selfOnline && peerOnline ? undefined : '3 2'}
        opacity={selfOnline && peerOnline ? 0.7 : 0.2}
        filter={selfOnline && peerOnline ? 'url(#neonGlow)' : undefined}
      />
      {selfOnline && peerOnline && (
        <circle cx="28" cy="12" r="1.5" fill="#39FF14" opacity="0.8" filter="url(#neonGlow)" />
      )}
      <g filter={peerOnline ? 'url(#neonGlow)' : undefined}>
        <circle cx="46" cy="9" r="4" fill={peerOnline ? '#39FF14' : '#555'} opacity={peerOnline ? 0.9 : 0.3} />
        <path d="M40 20 Q46 14 52 20" fill={peerOnline ? '#39FF14' : '#555'} opacity={peerOnline ? 0.6 : 0.2} />
      </g>
    </svg>
  </div>
);


// ─────────────────────────────────────────────────────────────────────────────
// OChat — main component
// ─────────────────────────────────────────────────────────────────────────────
type View = 'home' | 'new' | 'chat';

export function OChat() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();

  // View routing
  const [view, setView] = useState<View>('home');

  // Conversation state
  const [peerAddress, setPeerAddress] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<XmtpMessage[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any | null>(null);

  // XMTP connection state
  const [xmtpStatus, setXmtpStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [errorMsg, setErrorMsg] = useState('');
  const [isInstallationLimit, setIsInstallationLimit] = useState(false);
  const [userSignedOut, setUserSignedOut] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') return localStorage.getItem('xmtp_signed_out') === 'true';
    } catch {}
    return false;
  });
  const [isRevoking, setIsRevoking] = useState(false);
  const [connectStep, setConnectStep] = useState('');
  const cachedInboxIdRef = useRef<string | undefined>(undefined);

  // New conversation flow
  const [canMessagePeer, setCanMessagePeer] = useState<boolean | null>(null);
  const [isCheckingPeer, setIsCheckingPeer] = useState(false);
  const [isStartingConvo, setIsStartingConvo] = useState(false);
  const [startConvoError, setStartConvoError] = useState('');

  // Image sending
  const [isSendingImage, setIsSendingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stream & message tracking refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const seenMsgIdsRef = useRef(new Set<string>());
  const [newMsgIds, setNewMsgIds] = useState<Set<string>>(new Set());

  // Delivery receipt tracking — tempId/realId → status
  const [msgStatuses, setMsgStatuses] = useState<Record<string, 'sending' | 'sent' | 'delivered'>>({});
  const pendingSendsRef = useRef<Map<string, { content: string; timestamp: number }>>(new Map());

  // Peer online presence
  const [peerOnline, setPeerOnline] = useState(false);
  const peerLastHeartbeatRef = useRef<number>(0);

  // Nickname / address resolution
  const [peerAddressMap, setPeerAddressMap] = useState<Record<string, string>>(() => getAllInboxMap());
  const [nicknames, setNicknames] = useState<Record<string, string>>(() => getAllNicknames());
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  // Search / filter
  const [searchFilter, setSearchFilter] = useState('');

  // ── Display name resolution ─────────────────────────────────────────────────
  // Priority: custom nickname → Oden profile username → shortened wallet address
  const getPeerDisplayName = useCallback((inboxId: string): string => {
    if (!inboxId) return 'Unknown';
    const nick = nicknames[inboxId.toLowerCase()];
    if (nick) return nick;
    const addr = peerAddressMap[inboxId.toLowerCase()] || getInboxAddress(inboxId);
    if (addr) {
      const profile = getProfile(addr);
      if (profile?.username) return profile.username;
      if (profile?.chatAlias) return profile.chatAlias;
      return shortenAddress(addr);
    }
    return `${inboxId.slice(0, 6)}...${inboxId.slice(-4)}`;
  }, [nicknames, peerAddressMap]);

  const getPeerWalletLabel = useCallback((inboxId: string): string | null => {
    const addr = peerAddressMap[inboxId.toLowerCase()] || getInboxAddress(inboxId);
    return addr ? shortenAddress(addr) : null;
  }, [peerAddressMap]);

  const saveNickname = useCallback((peerInboxId: string, nick: string) => {
    setChatNickname(peerInboxId, nick);
    setNicknames(prev => {
      const updated = { ...prev };
      const trimmed = nick.trim();
      if (trimmed) updated[peerInboxId.toLowerCase()] = trimmed;
      else delete updated[peerInboxId.toLowerCase()];
      return updated;
    });
  }, []);

  // ── System / control message filter ────────────────────────────────────────
  const isSystemMessage = (content: string): boolean => {
    if (!content || !content.startsWith('{')) return false;
    if (isControlMessage(content)) return true;
    try {
      const parsed = JSON.parse(content);
      return 'initiatedByInboxId' in parsed || 'addedInboxes' in parsed || 'removedInboxes' in parsed;
    } catch { return false; }
  };

  // ── Nuke conversation ───────────────────────────────────────────────────────
  // 1. Stop stream immediately
  // 2. Clear all local state
  // 3. Fire-and-forget: broadcast NUKE signal to peer over XMTP
  const handleNukeChat = useCallback(async () => {
    if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
    const convo = activeConversation;
    const client = getXmtpClient();
    seenMsgIdsRef.current.clear();
    setNewMsgIds(new Set());
    pendingSendsRef.current.clear();
    setMsgStatuses({});
    setPeerOnline(false);
    setMessages([]);
    setActiveConversation(null);
    setView('home');
    if (convo && client) {
      sendMessage(convo, JSON.stringify({ type: NUKE_TYPE, nukerId: client.inboxId })).catch(() => {});
    }
  }, [activeConversation]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Lock body scroll in chat view (prevents page scroll interfering with message list)
  useEffect(() => {
    if (view === 'chat' && activeConversation) {
      document.documentElement.style.overflow = 'hidden';
      return () => { document.documentElement.style.overflow = ''; };
    }
  }, [view, activeConversation]);

  const connectingRef = useRef(false);

  // ── XMTP connection ─────────────────────────────────────────────────────────
  const connectXmtp = useCallback(async () => {
    if (!walletClient || !isConnected) return;
    if (connectingRef.current) return;
    if (getXmtpClient()) { setXmtpStatus('connected'); return; }
    connectingRef.current = true;
    setXmtpStatus('connecting');
    setErrorMsg('');
    setIsInstallationLimit(false);
    setConnectStep('Initializing XMTP SDK...');
    try {
      await initXmtp(walletClient);
      setXmtpStatus('connected');
      setConnectStep('');
    } catch (err: any) {
      setXmtpStatus('error');
      setConnectStep('');
      const msg = err?.message || 'Failed to connect to XMTP network';
      if ((err as any)?.code === XMTP_INSTALLATION_LIMIT || msg.includes('already registered') || msg.includes('10/10')) {
        cachedInboxIdRef.current = (err as any)?.inboxId;
        setIsInstallationLimit(true);
        setErrorMsg('You\'ve reached the XMTP device limit (10/10). Revoke old devices to free up a slot.');
      } else if (msg.includes('timed out')) {
        setErrorMsg('Connection timed out — XMTP network may be slow. Click Retry.');
      } else if (msg.includes('Worker') || msg.includes('wasm') || msg.includes('WASM')) {
        setErrorMsg('Failed to load XMTP. Try refreshing the page.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      connectingRef.current = false;
    }
  }, [walletClient, isConnected]);

  // One-click revoke all other installations and reconnect
  const handleRevokeAndConnect = useCallback(async () => {
    if (!walletClient || !isConnected) return;
    setIsRevoking(true);
    setErrorMsg('');
    try {
      await revokeOtherInstallationsAndConnect(walletClient, cachedInboxIdRef.current);
      setXmtpStatus('connected');
      setIsInstallationLimit(false);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Revocation failed');
    } finally {
      setIsRevoking(false);
    }
  }, [walletClient, isConnected]);

  const handleSignOut = useCallback(() => {
    if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
    disconnectXmtp();
    setXmtpStatus('disconnected');
    setConversations([]);
    setActiveConversation(null);
    setMessages([]);
    setView('home');
    setUserSignedOut(true);
    try { localStorage.setItem('xmtp_signed_out', 'true'); } catch {}
    hasAttemptedConnect.current = true;
  }, []);

  // Auto-connect once when wallet is ready (skipped if user manually signed out)
  const hasAttemptedConnect = useRef(false);
  useEffect(() => {
    if (walletClient && isConnected && xmtpStatus === 'disconnected' && !hasAttemptedConnect.current && !userSignedOut) {
      hasAttemptedConnect.current = true;
      connectXmtp();
    }
  }, [walletClient, isConnected, xmtpStatus, connectXmtp, userSignedOut]);

  // Clear XMTP when wallet disconnects or switches address
  const prevAddressRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const addressChanged = prevAddressRef.current !== undefined && prevAddressRef.current !== address;
    prevAddressRef.current = address;
    if (!isConnected || addressChanged) {
      hasAttemptedConnect.current = false;
      setUserSignedOut(false);
      try { localStorage.removeItem('xmtp_signed_out'); } catch {}
      disconnectXmtp();
      setXmtpStatus('disconnected');
      if (addressChanged) setConversations([]);
      if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
      setActiveConversation(null);
      setMessages([]);
      setView('home');
    }
  }, [isConnected, address]);

  // ── Conversation loading ────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (xmtpStatus !== 'connected') return;
    try {
      const convos = await getConversations();
      if (convos.length === 0 && !getXmtpClient()) {
        setXmtpStatus('disconnected');
        hasAttemptedConnect.current = false;
        return;
      }
      if (convos.length > 0) {
        setConversations(convos);
        setCachedConversations(convos.map((c: any) => ({
          id: c.id,
          peerInboxId: c._peerInboxId || '',
        })));
      }
      const unmapped = convos
        .map((c: any) => c._peerInboxId as string)
        .filter((id): id is string => !!id && !getInboxAddress(id));
      if (unmapped.length > 0) {
        resolveInboxAddresses(unmapped).then(resolved => {
          if (Object.keys(resolved).length === 0) return;
          for (const [inboxId, addr] of Object.entries(resolved)) setInboxAddress(inboxId, addr);
          setPeerAddressMap(prev => ({ ...prev, ...resolved }));
        });
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [xmtpStatus]);

  // Show cached conversations instantly on mount while XMTP syncs
  useEffect(() => {
    if (conversations.length > 0) return;
    const cached = getCachedConversations();
    if (cached.length > 0) {
      setConversations(cached.map(c => ({ id: c.id, _peerInboxId: c.peerInboxId, _cached: true })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll conversations every 10s (cross-device sync)
  useEffect(() => {
    if (xmtpStatus !== 'connected') return;
    loadConversations();
    const interval = setInterval(loadConversations, 10_000);
    return () => clearInterval(interval);
  }, [xmtpStatus, loadConversations]);

  // ── Message streaming + presence + delivery receipts ───────────────────────
  // Full streaming logic including:
  //   - Filter messages after nuke timestamp
  //   - Process control messages (presence heartbeat, delivery receipt batching)
  //   - PRESENCE: send online heartbeat every 45s
  //   - DELIVERY: debounced batch receipts (1.5s window)
  //   - Optimistic message replacement (temp IDs merged into real IDs on confirmation)
  //   - Real-time stream with reconnect on error
  // [See live implementation at https://oden-net-work.vercel.app]

  // ── Send text message ───────────────────────────────────────────────────────
  // Optimistic update: adds a temp message immediately, replaces on confirmation

  // ── Send image attachment ───────────────────────────────────────────────────
  // Compresses via compressImage() before calling sendImageAttachment()

  // ── Render ──────────────────────────────────────────────────────────────────
  // Split-panel layout:
  //   Left: conversation list with search, nicknames, last-message preview
  //   Right: active chat or new conversation form
  //
  // Features rendered:
  //   - ConnectWalletCard (unauthenticated state)
  //   - XMTP connecting / error / installation-limit states
  //   - Conversation list with filter, nicknames, delivery receipt ticks
  //   - Chat header: OnlineIndicator, NukeIcon, inline nickname editor
  //   - Message list: DecryptText animation, image attachments, delivery ticks
  //   - Message input: text + image upload
  //   - E2EE badge in sidebar footer
  //
  // [Full JSX implementation runs in production at https://oden-net-work.vercel.app]

  return null; // placeholder — see live dapp for full render output
}
