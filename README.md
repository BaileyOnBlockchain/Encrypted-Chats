# O-Chat — Production XMTP Messaging Components

> End-to-end encrypted peer-to-peer messaging and ephemeral group rooms.  
> Built on [XMTP](https://xmtp.org) × [Base L2](https://base.org). Wallet-native. Zero servers. Zero leaks.

**→ Live in production: [odennetworkxr.com](https://odennetworkxr.com)**  
**→ Built by [@blockchainbail](https://x.com/blockchainbail)**

---

## Overview

These are the core UI components powering O-Chat — the encrypted messaging layer of **Oden Network XR**, a privacy-first decentralised social dapp on Base L2.

No backend. No message servers. No metadata collection.  
Every message is signed by a wallet and encrypted before it leaves the device.

---

## Components

### `OChat.tsx` — Encrypted P2P Messaging

Full peer-to-peer DM system with wallet-signed XMTP identity.

**Connection layer**
- Auto-initialises XMTP client on wallet connect, skips if user manually signed out
- XMTP installation limit detection (10/10) with one-click revoke-all-and-reconnect flow
- Cross-device conversation sync via 10s polling + live stream

**Messaging**
- Real-time message streaming via XMTP stream API
- Optimistic UI — messages appear instantly, temp IDs replaced on network confirmation
- Image attachments with client-side canvas compression (iterative quality reduction until under size limit)
- Conversation cache loaded instantly on mount — list visible before XMTP finishes syncing

**Control message system**  
Three JSON control types ride the same XMTP stream alongside regular messages, filtered before render:

| Type | Purpose |
|---|---|
| `OCHAT_NUKE` | Wipes the conversation for both parties simultaneously |
| `OCHAT_PRESENCE` | 45s heartbeat driving the online/offline indicator |
| `OCHAT_DELIVERED` | Batched, debounced delivery receipts (1.5s window) |

**UX**
- Decrypt animation — characters scramble then resolve left-to-right on message arrival (`requestAnimationFrame`, duration scales with length, history skips animation)
- Online presence SVG — two silhouettes with neon connection link, goes dashed when peer offline
- Inline nickname editor in chat header
- Display name resolution: custom nickname → Oden profile → shortened wallet address
- Body scroll locked in chat view (prevents page scroll interfering with message list)

---

### `OChatRooms.tsx` — Ephemeral Encrypted Group Rooms

Invite-only group messaging built on XMTP group messaging protocol.

**Room lifecycle**
- Create rooms with a name + self-destruct timer
- Invite members by wallet address (XMTP identity check before add)
- Accept or decline pending invitations
- Leave or nuke — nuking broadcasts `NUKE_SIGNAL` to all members then destroys the room locally

**Self-destruct timers**

| Option | Behaviour |
|---|---|
| 1h / 6h / 24h / 7d | Room auto-nukes when countdown hits zero |
| On Exit | Room destroyed when the creator leaves |

- 1s interval ticker drives live countdowns
- Rooms turning red + warning state when < 1 hour remaining
- Expiry enforcement runs on every tick — no server-side cron needed

**Streaming**
- Local cache loaded first (instant render), then network sync, then live stream opened
- Incoming `NUKE_SIGNAL` from any member destroys the room for the recipient immediately

---

## Tech

| | |
|---|---|
| Protocol | [XMTP](https://xmtp.org) (wallet-signed E2EE, group messaging) |
| Chain | Base L2 |
| Wallet | [wagmi](https://wagmi.sh) |
| Animation | [Framer Motion](https://www.framer.com/motion/) |
| Framework | Next.js App Router |
| Language | TypeScript |

---

## Architecture
```
OChat / OChatRooms
    │
    ├── xmtp-service        XMTP client init, conversation/group management, streaming
    ├── ochat-storage       Conversation cache, nicknames, inbox → address map
    ├── profile-storage     User profile resolution (username, avatar)
    └── UI primitives       GlassCard, ConnectWalletCard
```

Service layer interfaces documented in [`src/services/`](./src/services/).  
Internal implementations are private — this repo exposes architecture and patterns only.

---

## Live

Running in production at **[oden-net-work.vercel.app](https://oden-net-work.vercel.app)**

Follow **[@odennetworkXR](https://x.com/odennetworkXR)** for protocol updates and the $XR token launch.

---

*Solo-built. No VC. Privacy-first.*  
*Part of the [Oden Network](https://odennetworkxr.com) — a decentralised XR social layer on Base.*
