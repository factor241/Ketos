/**
 * Browser dictation for the window composer: the speech-recognition toggle the
 * voice button and the action menu's dictation entry drive, plus the mic glyph
 * (the shared icon set ships none). Recognition is the browser's own API; an
 * engine without it reports `supported: false`, and the control stays disabled
 * rather than pretending to listen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** One browser recognition result group; only the final transcript is read. */
interface RecognitionResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

/** The subset of the SpeechRecognition API this component uses. */
interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResult> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

/** The browser's recognition constructor, whichever vendor prefix carries it. */
function recognitionCtor(): RecognitionCtor | undefined {
  const scope = globalThis as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

/** Dictation state one composer binds to its voice control. */
export interface Dictation {
  /** Whether the engine exposes a recognition API at all. */
  readonly supported: boolean
  /** Whether a recognition session is running. */
  readonly listening: boolean
  /** Start listening, or stop the running session. */
  readonly toggle: () => void
  /** Stop the running session, if any. */
  readonly stop: () => void
}

/**
 * Bind one composer's dictation session.
 * @param onText - receives each final transcript snippet to append to the draft.
 * @returns the toggle state and control; the session stops with the component.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [supported] = useState(() => recognitionCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const engine = useRef<RecognitionLike | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const stop = useCallback(() => {
    engine.current?.stop()
    engine.current = null
    setListening(false)
  }, [])

  const toggle = useCallback(() => {
    if (listening) {
      stop()
      return
    }
    const Ctor = recognitionCtor()
    if (Ctor === undefined) return
    const session = new Ctor()
    session.lang = navigator.language
    session.continuous = true
    session.interimResults = true
    session.onresult = (event) => {
      let text = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result?.isFinal === true) text += result[0].transcript
      }
      const trimmed = text.trim()
      if (trimmed !== '') onTextRef.current(trimmed)
    }
    // A stopped session's async end arrives after the next one started, so the
    // handler may only clear the state it owns.
    const settle = (): void => {
      if (engine.current !== session) return
      engine.current = null
      setListening(false)
    }
    session.onend = settle
    session.onerror = settle
    engine.current = session
    session.start()
    setListening(true)
  }, [listening, stop])

  // A closing window must not leave the microphone running.
  useEffect(() => () => { engine.current?.stop(); engine.current = null }, [])

  return { supported, listening, toggle, stop }
}

/**
 * Microphone glyph for the composer's voice control.
 * @returns the icon, sized like the shared 16px set and riding `currentColor`.
 */
export function MicGlyph(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="1.75" width="4" height="7.5" rx="2" />
      <path d="M3.75 7.5a4.25 4.25 0 0 0 8.5 0" />
      <line x1="8" y1="11.75" x2="8" y2="14.25" />
    </svg>
  )
}
