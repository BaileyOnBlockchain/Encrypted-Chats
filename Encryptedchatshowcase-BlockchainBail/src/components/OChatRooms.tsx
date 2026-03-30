'use client';

/**
 * OChatRooms.tsx — Ephemeral Encrypted Group Rooms
 *
 * Invite-only group messaging with self-destruct timers, built on XMTP group messaging.
 * Part of the O-Chat module of Oden Network XR.
 *
 * Live: https://oden-net-work.vercel.app
 * Built by @blockchainbail — https://x.com/blockchainbail
 *
 * Internal service imports have been replaced with generic paths.
 * See src/services/ for interface contracts.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, useWalletClient } from 'wagmi';
import {
  MessageCircle, Plus, Lock, Clock, Users, ArrowLeft, Send, Flame, LogOut, Shield, UserPlus, Loader2, Check, X
} from 'lucide-react';

// ── UI primitives — replace with your own components ──────────────────────────
import { GlassCard } from './ui/GlassCard';
import { ConnectWalletCard } from './ui/ConnectWalletCard';

// ── XMTP service layer — see src/services/xmtp-service.interface.ts ───────────
import {
  initXmtp,
  getXmtpClient,
  canMessage,
  createGroup,
  getGroups,
  addGroupMember,
  acceptGroupInvite,
  declineGroupInvite,
  sendGroupMessage,
  getGroupMessages,
  getGroupMessagesLocal,
  streamGroupMessages,
  resolveInboxAddresses,
  revokeOtherInstallationsAndConnect,
  XMTP_INSTALLATION_LIMIT,
  NUKE_SIGNAL,
  type XmtpMessage,
} from './services/xmtp-service';


// ─────────────────────────────────────────────────────────────────────────────
// Room metadata — persisted to localStorage per wallet address
// ─────────────────────────────────────────────────────────────────────────────
interface RoomMeta {
  groupId: string;
  name: string;
  destructTimer: string; // '1h' | '6h' | '24h' | '7d' | 'exit'
  createdAt: number;
  inviteOnly: boolean;
}

const TIMER_OPTIONS = [
  { value: '1h',   label: '1 hour' },
  { value: '6h',   label: '6 hours' },
  { value: '24h',  label: '24 hours' },
  { value: '7d',   label: '7 days' },
  { value: 'exit', label: 'On Exit' },
];


// ─────────────────────────────────────────────────────────────────────────────
// Self-destruct timer helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the Unix timestamp (ms) at which this room expires, or 0 for "on exit". */
function getDestructionTime(meta: RoomMeta): number {
  const created = meta.createdAt;
  switch (meta.destructTimer) {
    case '1h':  return created + 3_600_000;
    case '6h':  return created + 21_600_000;
    case '24h': return created + 86_400_000;
    case '7d':  return created + 604_800_000;
    default:    return 0; // 'exit' — no countdown
  }
}

/** Human-readable countdown from a future timestamp. */
function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Expired';
  const hrs  = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  if (hrs > 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  if (hrs > 0)  return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

const shortenAddr = (addr: string): string =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Unknown';


// ─────────────────────────────────────────────────────────────────────────────
// Decrypt animation — same pattern as OChat.tsx
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
// Custom nuclear hazard icon — used for the room nuke action
// ─────────────────────────────────────────────────────────────────────────────
const NukeIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="12" cy="12" r="2.4" />
    <path d="M10.25 8.97 A3.5 3.5 0 0 1 13.75 8.97 L16.5 4.21 A9 9 0 0 0 7.5 4.21 Z" />
    <path d="M15.5 12 A3.5 3.5 0 0 1 13.75 15.03 L16.5 19.79 A9 9 0 0 0 21 12 Z" />
    <path d="M10.25 15.03 A3.5 3.5 0 0 1 8.5 12 L3 12 A9 9 0 0 0 7.5 19.79 Z" />
  </svg>
);


// ─────────────────────────────────────────────────────────────────────────────
// RoomMeta persistence — keyed by lowercased wallet address
// ─────────────────────────────────────────────────────────────────────────────
function getRoomMeta(address: string): RoomMeta[] {
  try {
    const raw = localStorage.getItem(`ochat_rooms_meta_${address.toLowerCase()}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRoomMeta(address: string, metas: RoomMeta[]) {
  try {
    localStorage.setItem(`ochat_rooms_meta_${address.toLowerCase()}`, JSON.stringify(metas));
  } catch {}
}


// ─────────────────────────────────────────────────────────────────────────────
// OChatRooms — main component
// ─────────────────────────────────────────────────────────────────────────────
export function OChatRooms() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();

  // XMTP state — check if already connected from another tab on mount
  const [xmtpReady, setXmtpReady] = useState(() => !!getXmtpClient());
  const [xmtpLoading, setXmtpLoading] = useState(false);
  const [xmtpError, setXmtpError] = useState<string | null>(null);
  const [isInstallationLimit, setIsInstallationLimit] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  // Gate: user must explicitly click "Connect" before we trigger the wallet signature
  const [hasClickedConnect, setHasClickedConnect] = useState(false);
  const cachedInboxIdRef = useRef<string | undefined>(undefined);

  // Room state
  const [roomMetas, setRoomMetas] = useState<RoomMeta[]>([]);
  const [xmtpGroups, setXmtpGroups] = useState<any[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const roomMetasRef = useRef<RoomMeta[]>([]);
  useEffect(() => { roomMetasRef.current = roomMetas; }, [roomMetas]);
  const [messages, setMessages] = useState<XmtpMessage[]>([]);
  const [inboxAddressMap, setInboxAddressMap] = useState<Record<string, string>>({});

  // Create room form state
  const [newRoomName, setNewRoomName] = useState('');
  const [destructTimer, setDestructTimer] = useState('24h');
  const [inviteAddress, setInviteAddress] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamCleanupRef = useRef<(() => void) | null>(null);
  const seenMsgIdsRef = useRef(new Set<string>());
  const [newMsgIds, setNewMsgIds] = useState<Set<string>>(new Set());

  // Live countdown ticker (1s interval)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // ── Load room metadata on wallet connect ────────────────────────────────────
  useEffect(() => {
    if (!address) { setRoomMetas([]); return; }
    setRoomMetas(getRoomMeta(address));
  }, [address]);

  // ── XMTP connection ─────────────────────────────────────────────────────────
  const connectXmtp = useCallback(async () => {
    if (!walletClient || !address) return;
    setXmtpLoading(true);
    setXmtpError(null);
    setIsInstallationLimit(false);
    try {
      await initXmtp(walletClient);
      setXmtpReady(true);
      // Sync groups after connecting
      const groups = await getGroups();
      setXmtpGroups(groups);
    } catch (err: any) {
      const msg = err?.message || 'Failed to connect';
      if ((err as any)?.code === XMTP_INSTALLATION_LIMIT || msg.includes('10/10') || msg.includes('already registered')) {
        cachedInboxIdRef.current = (err as any)?.inboxId;
        setIsInstallationLimit(true);
        setXmtpError('XMTP device limit reached (10/10). Revoke old devices to reconnect.');
      } else {
        setXmtpError(msg);
      }
    } finally {
      setXmtpLoading(false);
    }
  }, [walletClient, address]);

  // Explicit connect gate — prevents wallet signature prompt on page load
  useEffect(() => {
    if (hasClickedConnect && walletClient && isConnected && !xmtpReady) {
      connectXmtp();
    }
  }, [hasClickedConnect, walletClient, isConnected, xmtpReady, connectXmtp]);

  // ── Group sync ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!xmtpReady) return;
    getGroups().then(setXmtpGroups).catch(console.error);
  }, [xmtpReady]);

  // ── Create room ─────────────────────────────────────────────────────────────
  const createRoom = useCallback(async () => {
    if (!newRoomName.trim() || !address || !xmtpReady) return;
    setCreating(true);
    try {
      const group = await createGroup(newRoomName.trim());
      const meta: RoomMeta = {
        groupId: group.id,
        name: newRoomName.trim(),
        destructTimer,
        createdAt: Date.now(),
        inviteOnly: true,
      };
      const updated = [meta, ...roomMetasRef.current];
      setRoomMetas(updated);
      saveRoomMeta(address, updated);
      setXmtpGroups(prev => [group, ...prev]);
      setNewRoomName('');
      setActiveGroupId(group.id);
    } catch (err: any) {
      console.error('Failed to create room:', err);
    } finally {
      setCreating(false);
    }
  }, [newRoomName, address, xmtpReady, destructTimer]);

  // ── Invite member ───────────────────────────────────────────────────────────
  const handleInvite = useCallback(async (groupId: string) => {
    if (!inviteAddress.trim() || !xmtpReady) return;
    setInviting(true);
    setInviteError('');
    setInviteSuccess(false);
    try {
      const canMsg = await canMessage(inviteAddress.trim());
      if (!canMsg) { setInviteError('This address hasn\'t joined XMTP yet.'); return; }
      const group = xmtpGroups.find(g => g.id === groupId);
      if (!group) { setInviteError('Room not found.'); return; }
      await addGroupMember(group, inviteAddress.trim());
      setInviteSuccess(true);
      setInviteAddress('');
    } catch (err: any) {
      setInviteError(err?.message || 'Failed to invite member');
    } finally {
      setInviting(false);
    }
  }, [inviteAddress, xmtpReady, xmtpGroups]);

  // ── Accept / decline invitations ────────────────────────────────────────────
  const handleAcceptInvite = useCallback(async (group: any) => {
    if (!address) return;
    setAcceptingId(group.id);
    try {
      await acceptGroupInvite(group);
      const meta: RoomMeta = {
        groupId: group.id,
        name: group.name || 'Unnamed Room',
        destructTimer: '24h',
        createdAt: Date.now(),
        inviteOnly: true,
      };
      const updated = [meta, ...roomMetasRef.current];
      setRoomMetas(updated);
      saveRoomMeta(address, updated);
      setActiveGroupId(group.id);
    } catch (err) {
      console.error('Failed to accept invite:', err);
    } finally {
      setAcceptingId(null);
    }
  }, [address]);

  const handleDeclineInvite = useCallback(async (group: any) => {
    try {
      await declineGroupInvite(group);
      setXmtpGroups(prev => prev.filter(g => g.id !== group.id));
    } catch (err) {
      console.error('Failed to decline invite:', err);
    }
  }, []);

  // ── Nuke room ───────────────────────────────────────────────────────────────
  // 1. Broadcast NUKE_SIGNAL to all room members over XMTP
  // 2. Remove room from local metadata
  // 3. Leave the XMTP group
  const handleNuke = useCallback(async (groupId: string) => {
    if (!address) return;
    const group = xmtpGroups.find(g => g.id === groupId);
    if (group) {
      try { await sendGroupMessage(group, NUKE_SIGNAL); } catch {}
      try { await group.leave?.(); } catch {}
    }
    const updated = roomMetasRef.current.filter(m => m.groupId !== groupId);
    setRoomMetas(updated);
    saveRoomMeta(address, updated);
    setXmtpGroups(prev => prev.filter(g => g.id !== groupId));
    if (activeGroupId === groupId) {
      setActiveGroupId(null);
      setMessages([]);
      if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
    }
  }, [address, xmtpGroups, activeGroupId]);

  // ── Self-destruct timer enforcement ────────────────────────────────────────
  // Check on every `now` tick whether any rooms have passed their expiry
  useEffect(() => {
    if (!address || roomMetas.length === 0) return;
    const expired = roomMetas.filter(m => {
      const t = getDestructionTime(m);
      return t > 0 && now >= t;
    });
    if (expired.length === 0) return;
    expired.forEach(m => handleNuke(m.groupId));
  }, [now, roomMetas, address, handleNuke]);

  // ── Message streaming ───────────────────────────────────────────────────────
  // On active room change: load local cache instantly, then sync from network,
  // then open a live stream. Handles NUKE_SIGNAL from peers by destroying the room.
  useEffect(() => {
    if (streamCleanupRef.current) { streamCleanupRef.current(); streamCleanupRef.current = null; }
    seenMsgIdsRef.current.clear();
    setNewMsgIds(new Set());
    if (!activeGroupId || !xmtpReady) return;

    const group = xmtpGroups.find(g => g.id === activeGroupId);
    if (!group) return;

    let cancelled = false;

    const load = async () => {
      // Fast path: local cache
      try {
        const local = await getGroupMessagesLocal(group);
        if (!cancelled && local.length > 0) {
          const filtered = local.filter(m => m.content !== NUKE_SIGNAL);
          setMessages(filtered);
          filtered.forEach(m => seenMsgIdsRef.current.add(m.id));
        }
      } catch {}

      // Network sync
      try {
        const remote = await getGroupMessages(group);
        if (!cancelled) {
          if (remote.some(m => m.content === NUKE_SIGNAL)) {
            handleNuke(activeGroupId);
            return;
          }
          const filtered = remote.filter(m => m.content !== NUKE_SIGNAL);
          setMessages(filtered);
          filtered.forEach(m => seenMsgIdsRef.current.add(m.id));
        }
      } catch {}

      // Live stream
      if (!cancelled) {
        const cleanup = await streamGroupMessages(group, (msg) => {
          if (msg.content === NUKE_SIGNAL) { handleNuke(activeGroupId); return; }
          if (seenMsgIdsRef.current.has(msg.id)) return;
          seenMsgIdsRef.current.add(msg.id);
          setMessages(prev => [...prev, msg]);
          setNewMsgIds(prev => new Set(prev).add(msg.id));
        });
        streamCleanupRef.current = cleanup;
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeGroupId, xmtpReady, xmtpGroups, handleNuke]);

  // ── Send message ────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!message.trim() || !activeGroupId || !xmtpReady) return;
    const group = xmtpGroups.find(g => g.id === activeGroupId);
    if (!group) return;
    const text = message.trim();
    setMessage('');
    await sendGroupMessage(group, text).catch(console.error);
  }, [message, activeGroupId, xmtpReady, xmtpGroups]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Render ──────────────────────────────────────────────────────────────────
  // Sections rendered:
  //   - ConnectWalletCard (unauthenticated)
  //   - XMTP connect / installation-limit states
  //   - Create Room form (name input + timer select + security badge)
  //   - Pending Invitations (accept / decline)
  //   - Active Rooms list (countdown timers, expiry warnings, nuke button)
  //   - Active room chat panel (messages with DecryptText, invite member, send input)
  //
  // Key UI interactions:
  //   - NukeIcon button: rotates and glows red on hover, nukes room on click
  //   - Room card: red tinted when < 1h remaining
  //   - Invite-only badge (Lock icon) on room cards
  //
  // [Full JSX implementation runs in production at https://oden-net-work.vercel.app]

  return null; // placeholder — see live dapp for full render output
}
