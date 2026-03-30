# O-Chat — XMTP E2EE Messaging Components

> Production React components powering the encrypted messaging layer of **[Oden Network XR](https://odennetworkxr.com)** — a privacy-first decentralised social dapp on Base L2.

**Live dapp → [oden-net-work.vercel.app](https://oden-net-work.vercel.app)**  
**Built by [@blockchainbail](https://x.com/blockchainbail)** · [YouTube](https://www.youtube.com/@BailOnBlockchain) · [Kick](https://kick.com/blockchainbailey)

---

## What's in here

These are the two core UI components that drive O-Chat — the encrypted messaging module of Oden Network XR. Internal service implementations are abstracted; the component architecture and UI logic are intact.

### `OChat.tsx`
Full peer-to-peer encrypted DM system.

- XMTP protocol integration (wallet-signed identity, E2EE by default)
- Real-time message streaming with live delivery receipts (`✓` / `✓✓`)
- Online presence system (OCHAT_PRESENCE control messages)
- **Decrypt animation** — scrambled characters resolve left-to-right as messages "decrypt" on arrival
- **Nuke** — wipe an entire conversation from both ends via XMTP signal
- Image attachment support with client-side compression (canvas, iterative quality reduction)
- Nickname system, conversation caching, hide/archive conversations
- Wallet installation limit handling with revoke + reconnect flow
- Mobile-responsive split-panel layout with full motion animations

### `OChatRooms.tsx`
Ephemeral encrypted group rooms.

- XMTP group messaging (invite-only, wallet-address gated)
- **Self-destruct timers** — rooms expire at 1h / 6h / 24h / 7d or on exit
- Live countdown with expiry warnings
- Nuke button — broadcasts NUKE_SIGNAL to all members and destroys the room
- Pending invitation accept/decline flow
- Same DecryptText animation as DM layer

---

## Tech

| Layer | Stack |
|---|---|
| Messaging protocol | [XMTP](https://xmtp.org) |
| Wallet / chain | [wagmi](https://wagmi.sh) + Base L2 |
| Animation | [Framer Motion](https://www.framer.com/motion/) |
| Icons | [Lucide React](https://lucide.dev) |
| Framework | Next.js (App Router) |

---

## Architecture overview

```
OChat.tsx / OChatRooms.tsx
        │
        ├── xmtp-service          # XMTP client wrapper (initXmtp, sendMessage, streamMessages, etc.)
        ├── ochat-storage         # Conversation cache, nicknames, inbox address map
        ├── profile-storage       # User profile (display name, avatar)
        └── UI primitives         # GlassCard, ConnectWalletCard (bring your own)
```

Service interfaces are documented in [`src/services/`](./src/services/).

---

## Key patterns

**Decrypt animation**  
Messages arrive as scrambled characters, then resolve left-to-right using `requestAnimationFrame`. Duration scales with message length. New messages only — existing messages skip the animation.

**Control messages**  
Presence, delivery receipts and nuke signals are encoded as JSON payloads over the same XMTP stream, filtered out before render. No side channel needed.

**Image compression**  
Before sending, images are drawn to a canvas and iteratively compressed (quality `0.8 → 0.1`) until under the XMTP attachment size limit.

**Installation limit handling**  
XMTP caps device installations. When the limit is hit, the app detects the specific error code and offers a one-click revoke-all-and-reconnect flow rather than a dead end.

---

## Live

These components are running in production at **[oden-net-work.vercel.app](https://oden-net-work.vercel.app)**.  
The $XR token launch is imminent — follow **[@odennetworkXR](https://x.com/odennetworkXR)** for updates.

---

*Solo-built. No VC. Privacy-first.*
