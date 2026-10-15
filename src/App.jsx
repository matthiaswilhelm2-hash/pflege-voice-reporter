import { useState, useRef, useEffect, useCallback } from 'react'

const API_URL = '/api/extract'

function App() {
  // ── State ──
  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('neu') // 'neu' | 'berichte'
  const [medInput, setMedInput] = useState('')

  const [fields, setFields] = useState({
    name: '',
    alter: '',
    pflegegrad: '',
    fluessigkeit: { ja: null, menge: '', details: '' },
    medikamente: [],
  })

  const [berichte, setBerichte] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('pflege-berichte') || '[]')
    } catch { return [] }
  })

  const recognitionRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('pflege-berichte', JSON.stringify(berichte))
  }, [berichte])

  // ── Voice Recognition ──
  const startRecording = useCallback(() => {
    setError('')
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setError('Spracherkennung nicht verfügbar – bitte Chrome oder Edge verwenden.')
      return
    }

    const rec = new SR()
    rec.lang = 'de-DE'
    rec.continuous = true
    rec.interimResults = true
    recognitionRef.current = rec

    let collected = ''

    rec.onresult = (e) => {
      let interimBuf = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          collected += e.results[i][0].transcript + ' '
          setTranscript(collected.trim())
        } else {
          interimBuf += e.results[i][0].transcript
        }
      }
      setInterim(interimBuf)
    }

    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError('Sprachfehler: ' + e.error)
      }
    }

    rec.onend = () => {
      // Restart if still in recording mode
      if (recognitionRef.current) {
        try { recognitionRef.current.start() } catch (_) {}
      }
    }

    rec.start()
    setRecording(true)
    setTranscript('')
    setInterim('')
  }, [])

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      const ref = recognitionRef.current
      recognitionRef.current = null // prevent auto-restart
      ref.stop()
    }
    setRecording(false)
    setInterim('')
  }, [])

  // ── KI Extraction ──
  const runExtraction = useCallback(async () => {
    if (!transcript.trim()) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcript.trim() }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Server-Fehler ${res.status}`)
      }

      const data = await res.json()

      setFields({
        name: data.name || '',
        alter: data.alter != null ? String(data.alter) : '',
        pflegegrad: data.pflegegrad != null ? String(data.pflegegrad) : '',
        fluessigkeit: {
          ja: data.fluessigkeitsaufnahme?.aufgenommen ?? null,
          menge: data.fluessigkeitsaufnahme?.menge_ml != null ? String(data.fluessigkeitsaufnahme.menge_ml) : '',
          details: data.fluessigkeitsaufnahme?.details || '',
        },
        medikamente: data.medikamente || [],
      })
    } catch (err) {
      setError('KI-Analyse fehlgeschlagen: ' + err.message)
    }
    setLoading(false)
  }, [transcript])

  // ── Report Management ──
  const saveBericht = useCallback(() => {
    if (!fields.name && !transcript) return
    const bericht = {
      id: Date.now(),
      zeit: new Date().toISOString(),
      transcript,
      ...fields,
    }
    setBerichte(prev => [bericht, ...prev])
    setTranscript('')
    setInterim('')
    setFields({
      name: '', alter: '', pflegegrad: '',
      fluessigkeit: { ja: null, menge: '', details: '' },
      medikamente: [],
    })
  }, [fields, transcript])

  const deleteBericht = useCallback((id) => {
    setBerichte(prev => prev.filter(b => b.id !== id))
  }, [])

  // ── Medikamente helpers ──
  const addMed = useCallback(() => {
    const val = medInput.trim()
    if (!val) return
    setFields(f => ({ ...f, medikamente: [...f.medikamente, val] }))
    setMedInput('')
  }, [medInput])

  const removeMed = useCallback((i) => {
    setFields(f => ({ ...f, medikamente: f.medikamente.filter((_, idx) => idx !== i) }))
  }, [])

  // ── Field updaters ──
  const set = (key, val) => setFields(f => ({ ...f, [key]: val }))
  const setFluid = (key, val) => setFields(f => ({
    ...f, fluessigkeit: { ...f.fluessigkeit, [key]: val }
  }))

  // ── Render ──
  return (
    <div className="app">
      {/* Header */}
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-icon">PV</div>
          <div>
            <div className="topbar-title">Pflege Voice Reporter</div>
            <div className="topbar-sub">Sprechen. Erkennen. Dokumentieren.</div>
          </div>
        </div>
        <nav className="topbar-nav">
          <button className={`nav-btn ${tab === 'neu' ? 'nav-btn--active' : ''}`} onClick={() => setTab('neu')}>
            Neuer Bericht
          </button>
          <button className={`nav-btn ${tab === 'berichte' ? 'nav-btn--active' : ''}`} onClick={() => setTab('berichte')}>
            Berichte ({berichte.length})
          </button>
        </nav>
      </header>

      {error && (
        <div className="alert">
          {error}
          <button className="alert-close" onClick={() => setError('')}>x</button>
        </div>
      )}

      {tab === 'neu' ? (
        <main className="content">
          {/* ── Voice Section ── */}
          <section className="panel">
            <div className="panel-header">
              <h2>Sprachaufnahme</h2>
              <p>Sprechen Sie den Pflegebericht. Die KI extrahiert automatisch die wichtigsten Daten.</p>
            </div>

            <div className="mic-area">
              {!recording ? (
                <button className="mic-btn" onClick={startRecording} disabled={loading}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                  Aufnahme starten
                </button>
              ) : (
                <button className="mic-btn mic-btn--rec" onClick={stopRecording}>
                  <div className="mic-pulse"/>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                  </svg>
                  Stoppen
                </button>
              )}
            </div>

            {(transcript || interim || !recording) && (
              <div className="transcript">
                <div className="transcript-label-row">
                  <span className="transcript-label">
                    Erkannter Text
                    <span className="transcript-hint"> – hier können Sie Fehler direkt korrigieren</span>
                  </span>
                  {transcript && (
                    <button className="clear-btn" onClick={() => setTranscript('')}>Leeren</button>
                  )}
                </div>
                <textarea
                  className="transcript-textarea"
                  placeholder="Sprechen Sie zuerst – der erkannte Text erscheint hier und kann bearbeitet werden..."
                  value={recording ? transcript + (interim ? ' ' + interim : '') : transcript}
                  onChange={e => !recording && setTranscript(e.target.value)}
                  readOnly={recording}
                  rows={5}
                />
                {recording && (
                  <div className="recording-indicator">
                    <span className="rec-dot"/> Aufnahme läuft – Text wird live erkannt...
                  </div>
                )}
              </div>
            )}

            {transcript && !recording && (
              <button className="extract-btn" onClick={runExtraction} disabled={loading}>
                {loading ? (
                  <><span className="dot-loader"/> KI analysiert...</>
                ) : (
                  'KI-Analyse starten'
                )}
              </button>
            )}
          </section>

          {/* ── Fields Section ── */}
          <section className="panel">
            <div className="panel-header">
              <h2>Pflegedaten</h2>
              <p>Von der KI erkannte Felder – manuell korrigierbar</p>
            </div>

            <div className="form-grid">
              {/* 1 · Name */}
              <div className="form-field">
                <label><span className="badge">1</span> Name des Patienten</label>
                <input
                  type="text"
                  placeholder="z.B. Maria Schmidt"
                  value={fields.name}
                  onChange={e => set('name', e.target.value)}
                />
              </div>

              {/* 2 · Alter */}
              <div className="form-field">
                <label><span className="badge">2</span> Alter</label>
                <input
                  type="number"
                  placeholder="z.B. 82"
                  value={fields.alter}
                  onChange={e => set('alter', e.target.value)}
                />
              </div>

              {/* 3 · Pflegegrad */}
              <div className="form-field">
                <label><span className="badge">3</span> Pflegegrad</label>
                <div className="grade-row">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      className={`grade-btn ${fields.pflegegrad === String(n) ? 'grade-btn--on' : ''}`}
                      onClick={() => set('pflegegrad', String(n))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4 · Flüssigkeitsaufnahme */}
              <div className="form-field form-field--span">
                <label><span className="badge">4</span> Flüssigkeitsaufnahme</label>
                <div className="fluid-grid">
                  <div className="yn-group">
                    <button
                      className={`yn-btn ${fields.fluessigkeit.ja === true ? 'yn-btn--ja' : ''}`}
                      onClick={() => setFluid('ja', true)}
                    >Ja</button>
                    <button
                      className={`yn-btn ${fields.fluessigkeit.ja === false ? 'yn-btn--nein' : ''}`}
                      onClick={() => setFluid('ja', false)}
                    >Nein</button>
                  </div>
                  <input
                    type="number"
                    className="ml-input"
                    placeholder="ml"
                    value={fields.fluessigkeit.menge}
                    onChange={e => setFluid('menge', e.target.value)}
                  />
                  <input
                    type="text"
                    className="detail-input"
                    placeholder="z.B. Wasser, Tee, Kaffee"
                    value={fields.fluessigkeit.details}
                    onChange={e => setFluid('details', e.target.value)}
                  />
                </div>
              </div>

              {/* 5 · Medikamente */}
              <div className="form-field form-field--span">
                <label><span className="badge">5</span> Medikamente</label>
                {fields.medikamente.length > 0 && (
                  <div className="tag-list">
                    {fields.medikamente.map((m, i) => (
                      <span key={i} className="tag">
                        {m}
                        <button className="tag-x" onClick={() => removeMed(i)}>x</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="med-row">
                  <input
                    type="text"
                    placeholder="Medikament eingeben..."
                    value={medInput}
                    onChange={e => setMedInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addMed()}
                  />
                  <button className="add-btn" onClick={addMed}>+</button>
                </div>
              </div>
            </div>

            <button
              className="save-btn"
              onClick={saveBericht}
              disabled={!fields.name && !transcript}
            >
              Bericht speichern
            </button>
          </section>
        </main>
      ) : (
        /* ── Berichte Tab ── */
        <main className="content">
          <section className="panel">
            <div className="panel-header">
              <h2>Gespeicherte Berichte</h2>
            </div>
            {berichte.length === 0 ? (
              <div className="empty">Noch keine Berichte vorhanden.</div>
            ) : (
              <div className="bericht-list">
                {berichte.map(b => (
                  <div key={b.id} className="bericht">
                    <div className="bericht-top">
                      <strong>{b.name || 'Kein Name'}</strong>
                      <span className="bericht-date">{new Date(b.zeit).toLocaleString('de-DE')}</span>
                    </div>
                    <div className="bericht-tags">
                      {b.alter && <span className="bt">Alter: {b.alter}</span>}
                      {b.pflegegrad && <span className="bt">PG {b.pflegegrad}</span>}
                      {b.fluessigkeit?.ja != null && (
                        <span className="bt">
                          Flüssigkeit: {b.fluessigkeit.ja ? 'Ja' : 'Nein'}
                          {b.fluessigkeit.menge && ` (${b.fluessigkeit.menge} ml)`}
                        </span>
                      )}
                      {b.medikamente?.length > 0 && (
                        <span className="bt">Meds: {b.medikamente.join(', ')}</span>
                      )}
                    </div>
                    {b.transcript && <p className="bericht-text">"{b.transcript}"</p>}
                    <button className="del-btn" onClick={() => deleteBericht(b.id)}>Löschen</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

export default App
