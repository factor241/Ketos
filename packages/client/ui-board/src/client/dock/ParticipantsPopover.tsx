/**
 * Popover of the dock's participants control: the board roster with each
 * connected peer's link state, the invitation flow ("Invite" mints one code),
 * the connect flow ("Connect Ketos" redeems one), and "Forget" on a peer
 * without a live channel.
 *
 * The popover mounts in the dock's screen-space popover host (no windowId,
 * scale 1), stays inside the board box, closes on Escape or an outside click,
 * and keeps one request of each kind in flight at a time. The not-configured
 * hint replaces both flows only after the state route answered 404; before
 * the first answer neither appears, and a host the poll cannot reach keeps
 * the roster with every link shown as lost.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { MenuSurface } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { KetosPeerId } from '@ketos/peer/types'
import type { BoardStoreHandle } from '../store.ts'
import type { BoardPeerConnectOutcome, BoardPeerFailureCode, BoardPeerInviteOutcome } from '../contract/slots.ts'
import { boardParticipants, participantColorAttr, participantLabel } from '../owners.ts'
import type { BoardKey, BoardTranslate } from '../locale.ts'
import { forgetPeer as forgetPeerRoute, type BoardPeerForgetOutcome } from '../peer-api.ts'
import { useDockPopover } from './dock-popover.ts'
import css from './ParticipantsPopover.module.css'

/** Fixed width of the popover in screen pixels. */
const POPOVER_WIDTH = 280

/** Dictionary row each stable peer failure code names. */
const PEER_ERROR_KEY = {
  'ketos/invalid': 'peer.error.invalid',
  'ketos/peer-self': 'peer.error.self',
  'ketos/invite-used': 'peer.error.used',
  'ketos/peer-unreachable': 'peer.error.unreachable',
  'ketos/peer-offline': 'peer.error.offline',
  'ketos/peer-online': 'peer.error.online',
  'ketos/peer-unknown': 'peer.error.unknown',
  'ketos/peer-unavailable': 'peer.error.unreachable',
  'ketos/unreachable': 'peer.error.unreachable',
} as const satisfies Record<BoardPeerFailureCode, BoardKey>

/**
 * The address's clipboard API, or undefined where the runtime lacks one (a
 * non-secure context, jsdom). The DOM types declare it always present, so the
 * widened return type keeps both call-site branches honest.
 * @returns the clipboard, when the runtime has one.
 */
function clipboardApi(): Clipboard | undefined {
  return navigator.clipboard
}

/** Props of the participants popover. */
export interface ParticipantsPopoverProps {
  /** Screen rectangle of the dock control at open time. */
  readonly anchor: DOMRect
  /** Screen rectangle the popover stays inside. */
  readonly boundary: DOMRect
  /** Bound board dictionary. */
  readonly t: BoardTranslate
  /** Board store read seat; the roster and peer states come from here. */
  readonly useStore: PropsStore<BoardStoreHandle>['useStore']
  /** Ask the host for a one-time invitation code. */
  readonly createInvite: () => Promise<BoardPeerInviteOutcome>
  /** Connect the local node to the node one invitation code names. */
  readonly connectPeer: (invite: string) => Promise<BoardPeerConnectOutcome>
  /**
   * Ask the host to forget one known peer. Absent, the popover posts to the
   * peer forget route itself.
   */
  readonly forgetPeer?: (peerId: KetosPeerId) => Promise<BoardPeerForgetOutcome>
  /** Close without further requests. */
  readonly onClose: () => void
}

/**
 * Render the participants popover.
 * @param props - the anchor, the store seat, and the host verbs.
 * @returns the roster and the invitation, connect, and forget controls.
 */
export function ParticipantsPopover({
  anchor, boundary, t, useStore, createInvite, connectPeer, forgetPeer = forgetPeerRoute, onClose,
}: ParticipantsPopoverProps) {
  const roster = useStore(s => boardParticipants(s))
  const allPeers = useStore(s => s.peerStates)
  const records = useStore(s => s.boardParticipants)
  const selfId = useStore(s => s.selfId)
  const [forgotten, setForgotten] = useState<ReadonlySet<KetosPeerId>>(new Set())
  const [forgetting, setForgetting] = useState<KetosPeerId | null>(null)
  const [forgetError, setForgetError] = useState<BoardKey | null>(null)
  // A forgotten peer leaves the list before the next poll confirms it: a
  // participant only that peer named disappears, one the document records
  // stays without its link mark. A forgotten peer that reports an online link
  // reconnected and shows again.
  const peers = useMemo(
    () => allPeers.filter(peer => !forgotten.has(peer.peerId) || peer.link === 'online'),
    [allPeers, forgotten],
  )
  // Once a poll no longer lists a forgotten peer, the host confirmed it: the
  // entry is dropped, so the same peer key connecting again shows in any state.
  useEffect(() => {
    setForgotten((held) => {
      const kept = [...held].filter(peerId => allPeers.some(peer => peer.peerId === peerId))
      return kept.length === held.size ? held : new Set(kept)
    })
  }, [allPeers])
  const participants = useMemo(() => roster.filter(participant => participant.id === selfId
    || records.some(record => record.id === participant.id)
    || peers.some(peer => peer.selfId === participant.id)), [roster, records, selfId, peers])
  const available = useStore(s => s.peerAvailable)
  const missing = useStore(s => s.peerMissing)
  const [invite, setInvite] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState<BoardKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [code, setCode] = useState('')
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState<BoardKey | null>(null)
  const inviteRef = useRef<HTMLInputElement>(null)
  const codeInputId = useId()
  const trimmed = code.trim()
  const { surfaceRef, style, onKeyDown } = useDockPopover(anchor, boundary, POPOVER_WIDTH, onClose)

  const requestInvite = (): void => {
    if (inviteBusy) return
    setInviteBusy(true)
    setCopied(false)
    setInviteError(null)
    void createInvite().then((outcome) => {
      setInviteBusy(false)
      if (outcome.ok) {
        setInvite(outcome.invite)
        return
      }
      setInviteError(PEER_ERROR_KEY[outcome.code])
    })
  }

  /**
   * Copy the shown code; a missing or refused clipboard API falls back to
   * selecting the code text, so a manual copy stays possible on an insecure
   * address.
   */
  const copyInvite = (): void => {
    const input = inviteRef.current
    if (input === null || input.value === '') return
    // The DOM types declare clipboard as always present; a non-secure address
    // still lacks it at runtime, so the widened local keeps both paths typed.
    const clipboard = clipboardApi()
    if (clipboard === undefined) {
      input.select()
      return
    }
    void clipboard.writeText(input.value).then(() => { setCopied(true) }, () => { input.select() })
  }

  const requestForget = (peerId: KetosPeerId): void => {
    if (forgetting !== null) return
    setForgetting(peerId)
    setForgetError(null)
    void forgetPeer(peerId).then((outcome) => {
      setForgetting(null)
      // A peer the host no longer knows is as forgotten as one it just dropped.
      if (outcome.ok || outcome.code === 'ketos/peer-unknown') {
        setForgotten(held => new Set(held).add(peerId))
        return
      }
      setForgetError(PEER_ERROR_KEY[outcome.code])
    })
  }

  const submitConnect = (event: FormEvent): void => {
    event.preventDefault()
    if (trimmed === '' || connectBusy) return
    setConnectBusy(true)
    setConnectError(null)
    void connectPeer(trimmed).then((outcome) => {
      setConnectBusy(false)
      if (outcome.ok) {
        setCode('')
        return
      }
      setConnectError(PEER_ERROR_KEY[outcome.code])
    })
  }

  return (
    <MenuSurface
      ref={surfaceRef}
      className={css.popover}
      style={style}
      role="dialog"
      aria-label={t('peer.participants')}
      onKeyDown={onKeyDown}
    >
      <div className={css.title}>{t('peer.participants')}</div>
      <ul className={css.list}>
        {participants.map((participant) => {
          const peer = peers.find(candidate => candidate.selfId === participant.id)
          return (
            <li key={participant.id} className={css.row} data-board-participant={participant.id}>
              <span
                aria-hidden="true"
                data-board-owner-color={participantColorAttr(participant)}
                className={css.dot}
              />
              <span className={css.name}>{participantLabel(t, participant)}</span>
              {peer !== undefined && (
                <span className={css.link}>
                  {t(peer.link === 'online' ? 'peer.online' : 'peer.lost')}
                </span>
              )}
              {peer !== undefined && peer.link !== 'online' && (
                <button
                  type="button"
                  className={css.forget}
                  data-board-action="peer-forget"
                  aria-label={t('peer.forget.aria', { name: participantLabel(t, participant) })}
                  disabled={forgetting !== null}
                  onClick={() => { requestForget(peer.peerId) }}
                >
                  {t('peer.forget')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {forgetError !== null && (
        <div className={css.error} role="alert">{t(forgetError)}</div>
      )}
      {available
        ? (
          <>
            {invite === null
              ? (
                <>
                  <button
                    type="button"
                    className={css.action}
                    data-board-action="peer-invite"
                    disabled={inviteBusy}
                    onClick={requestInvite}
                  >
                    {t('peer.invite')}
                  </button>
                  {inviteError !== null && (
                    <div className={css.error} role="alert">{t(inviteError)}</div>
                  )}
                </>
              )
              : (
                <div className={css.invite}>
                  <input
                    ref={inviteRef}
                    className={css.code}
                    value={invite}
                    readOnly
                    aria-label={t('peer.invite')}
                    onFocus={(event) => { event.currentTarget.select() }}
                  />
                  <button type="button" className={css.action} data-board-action="peer-copy" onClick={copyInvite}>
                    {t(copied ? 'peer.invite.copied' : 'peer.invite.copy')}
                  </button>
                  <div className={css.hint}>{t('peer.invite.hint')}</div>
                </div>
              )}
            <form className={css.connect} onSubmit={submitConnect}>
              <label className={css.label} htmlFor={codeInputId}>{t('peer.connect')}</label>
              <div className={css.connectRow}>
                <input
                  id={codeInputId}
                  className={css.input}
                  value={code}
                  placeholder={t('peer.connect.placeholder')}
                  onChange={(event) => { setCode(event.target.value) }}
                />
                <button
                  type="submit"
                  className={css.action}
                  data-board-action="peer-connect"
                  disabled={connectBusy || trimmed === ''}
                >
                  {t('peer.connect.action')}
                </button>
              </div>
              {connectError !== null && (
                <div className={css.error} role="alert">{t(connectError)}</div>
              )}
            </form>
          </>
        )
        : missing ? <div className={css.unavailable}>{t('peer.unavailable')}</div> : null}
    </MenuSurface>
  )
}
