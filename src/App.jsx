// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { audioEngine } from './audioEngine';
import { SCALES, NOTE_NAMES, midiToNoteName } from './scales';

export default function App() {
  const [volume, setVolume] = useState(0.8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [selectedStepIndex, setSelectedStepIndex] = useState(null);

  const [selectedScale, setSelectedScale] = useState('Minor');
  const [rootNoteMidi, setRootNoteMidi] = useState(60);

  const [tracks, setTracks] = useState(audioEngine.tracks);

  const waveformCanvasRef = useRef(null);
  const visualizerCanvasRef = useRef(null);

  const currentTrack = tracks[selectedTrack];
  const currentStepData = selectedStepIndex !== null ? currentTrack.pattern[selectedStepIndex] : null;

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (currentTrack.type === 'sample' && currentTrack.sampleBuffer) {
      const buffer = currentTrack.sampleBuffer;
      const data = buffer.getChannelData(0);
      const step = Math.ceil(data.length / width);
      const amp = height / 2;

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);

      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;

      for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
          const datum = data[i * step + j];
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }
        ctx.moveTo(i, (1 + min) * amp);
        ctx.lineTo(i, (1 + max) * amp);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#64748b';
      ctx.font = '12px monospace';
      ctx.fillText('No sample buffer (Synth Oscillator Mode)', 15, height / 2 + 4);
    }
  }, [selectedTrack, tracks]);

  useEffect(() => {
    let animId;
    const canvas = visualizerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const renderVisualizer = () => {
      animId = requestAnimationFrame(renderVisualizer);

      if (!audioEngine.analyser) return;

      const bufferLength = audioEngine.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      audioEngine.analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barWidthPos = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;

        ctx.fillStyle = isPlaying ? '#10b981' : '#334155';
        ctx.fillRect(barWidthPos, canvas.height - barHeight, barWidth, barHeight);

        barWidthPos += barWidth + 1;
      }
    };

    renderVisualizer();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  const toggleStep = (stepIndex) => {
    const existing = currentTrack.pattern[stepIndex];
    const newActive = !existing.active;

    const updatedStep = { ...existing, active: newActive };
    audioEngine.setStepData(selectedTrack, stepIndex, updatedStep);

    const updatedTracks = [...tracks];
    updatedTracks[selectedTrack].pattern[stepIndex] = updatedStep;
    setTracks(updatedTracks);
    setSelectedStepIndex(stepIndex);
  };

  const updateStepProperty = (key, value) => {
    if (selectedStepIndex === null) return;

    const existing = currentTrack.pattern[selectedStepIndex];
    const updatedStep = { ...existing, [key]: value };

    audioEngine.setStepData(selectedTrack, selectedStepIndex, updatedStep);

    const updatedTracks = [...tracks];
    updatedTracks[selectedTrack].pattern[selectedStepIndex] = updatedStep;
    setTracks(updatedTracks);
  };

  const updateTrackADSR = (param, val) => {
    const numVal = parseFloat(val);
    const updated = { ...currentTrack, [param]: numVal };

    audioEngine.setTrackADSR(
      selectedTrack,
      param === 'attack' ? numVal : currentTrack.attack,
      param === 'decay' ? numVal : currentTrack.decay,
      param === 'sustain' ? numVal : currentTrack.sustain,
      param === 'release' ? numVal : currentTrack.release,
      param === 'cutoff' ? numVal : currentTrack.cutoff
    );

    const updatedTracks = [...tracks];
    updatedTracks[selectedTrack] = updated;
    setTracks(updatedTracks);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await audioEngine.loadSample(selectedTrack, file);
      const updatedTracks = [...tracks];
      updatedTracks[selectedTrack].sampleName = file.name;
      updatedTracks[selectedTrack].type = 'sample';
      setTracks(updatedTracks);
    } catch (err) {
      alert("Failed to load audio sample.");
    }
  };

  const handleTogglePlay = () => {
    audioEngine.init();
    if (isPlaying) {
      audioEngine.stopSequencer();
      setIsPlaying(false);
      setActiveStep(null);
    } else {
      audioEngine.startSequencer((step) => {
        setActiveStep(step);
      });
      setIsPlaying(true);
    }
  };

  const exportProjectJson = () => {
    const projectData = {
      version: '1.0.0',
      tempo: audioEngine.tempo,
      tracks: audioEngine.tracks.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        oscType: t.oscType,
        sampleName: t.sampleName,
        attack: t.attack,
        decay: t.decay,
        sustain: t.sustain,
        release: t.release,
        cutoff: t.cutoff,
        pattern: t.pattern
      }))
    };

    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bredforge-session.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importProjectJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        audioEngine.tempo = data.tempo || 120;
        audioEngine.tracks = data.tracks.map(t => ({
          ...t,
          sampleBuffer: null
        }));
        setTracks([...audioEngine.tracks]);
        alert('Project session successfully loaded offline!');
      } catch (err) {
        alert('Invalid project file format.');
      }
    };
    reader.readAsText(file);
  };

  const exportMasterWav = async () => {
    audioEngine.init();
    const wavBlob = await audioEngine.renderMasterWav();
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bredforge-master-mix.wav';
    a.click();
    URL.revokeObjectURL(url);
  };

  const scaleIntervals = SCALES[selectedScale] || SCALES.Chromatic;
  const availableMidiNotes = scaleIntervals.map(i => rootNoteMidi + i);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#090d16', color: '#f8fafc', padding: '1.25rem', fontFamily: 'monospace', touchAction: 'manipulation' }}>
      
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#38bdf8', margin: 0 }}>BredForge DAW</h1>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Production Release (Offline PWA Engine)</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={exportProjectJson} style={{ backgroundColor: '#334155', color: 'white', border: 'none', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', cursor: 'pointer' }}>💾 Save JSON</button>
          <label style={{ backgroundColor: '#334155', color: 'white', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', cursor: 'pointer', display: 'inline-block' }}>📂 Load JSON<input type="file" accept=".json" onChange={importProjectJson} style={{ display: 'none' }} /></label>
          <button onClick={exportMasterWav} style={{ backgroundColor: '#0284c7', color: 'white', border: 'none', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>🎵 Export WAV</button>
          <button onClick={handleTogglePlay} style={{ backgroundColor: isPlaying ? '#ef4444' : '#10b981', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '0.375rem', fontWeight: 'bold', cursor: 'pointer' }}>{isPlaying ? '■ STOP' : '▶ PLAY'}</button>
        </div>
      </header>

      <main style={{ display: 'grid', gap: '1rem', maxWidth: '900px', margin: '0 auto' }}>
        
        {/* Visualizer Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#111827', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>SAMPLE WAVEFORM CANVAS</span>
            <canvas ref={waveformCanvasRef} width={400} height={80} style={{ width: '100%', borderRadius: '0.25rem', border: '1px solid #334155' }} />
          </div>

          <div style={{ backgroundColor: '#111827', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 'bold', display: 'block', marginBottom: '0.5rem' }}>60FPS SPECTRUM ANALYZER</span>
            <canvas ref={visualizerCanvasRef} width={400} height={80} style={{ width: '100%', borderRadius: '0.25rem', border: '1px solid #334155' }} />
          </div>
        </div>

        {/* Channel & Sample Bar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'block', marginBottom: '0.5rem' }}>TRACK CHANNEL</span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              {tracks.map((t) => (
                <button key={t.id} onClick={() => { setSelectedTrack(t.id); setSelectedStepIndex(null); }} style={{ flex: 1, padding: '0.4rem', backgroundColor: selectedTrack === t.id ? '#0284c7' : '#1f2937', color: 'white', border: 'none', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer' }}>{t.name}</button>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'block', marginBottom: '0.5rem' }}>SCALE & ROOT</span>
            <select value={selectedScale} onChange={(e) => setSelectedScale(e.target.value)} style={{ width: '100%', backgroundColor: '#1f2937', color: 'white', border: '1px solid #374151', padding: '0.3rem', borderRadius: '0.25rem', fontSize: '0.8rem' }}>
              {Object.keys(SCALES).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', display: 'block', marginBottom: '0.5rem' }}>AUDIO SAMPLE</span>
            <label style={{ backgroundColor: '#0284c7', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '0.25rem', fontSize: '0.75rem', cursor: 'pointer', display: 'inline-block' }}>📁 Import WAV<input type="file" accept="audio/*" onChange={handleFileUpload} style={{ display: 'none' }} /></label>
            <span style={{ fontSize: '0.7rem', color: '#10b981', display: 'block', marginTop: '0.3rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentTrack.sampleName || 'Oscillator Synth'}</span>
          </div>
        </div>

        {/* Track ADSR */}
        <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
          <span style={{ fontSize: '0.8rem', color: '#38bdf8', fontWeight: 'bold', display: 'block', marginBottom: '0.75rem' }}>{currentTrack.name} ADSR & Filter Shaping</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', fontSize: '0.75rem' }}>
            <div><label>Attack: {currentTrack.attack}s</label><input type="range" min="0.005" max="0.5" step="0.005" value={currentTrack.attack} onChange={(e) => updateTrackADSR('attack', e.target.value)} style={{ width: '100%', accentColor: '#38bdf8' }} /></div>
            <div><label>Decay: {currentTrack.decay}s</label><input type="range" min="0.01" max="1.0" step="0.01" value={currentTrack.decay} onChange={(e) => updateTrackADSR('decay', e.target.value)} style={{ width: '100%', accentColor: '#38bdf8' }} /></div>
            <div><label>Sustain: {Math.round(currentTrack.sustain * 100)}%</label><input type="range" min="0" max="1" step="0.05" value={currentTrack.sustain} onChange={(e) => updateTrackADSR('sustain', e.target.value)} style={{ width: '100%', accentColor: '#38bdf8' }} /></div>
            <div><label>Release: {currentTrack.release}s</label><input type="range" min="0.01" max="1.5" step="0.01" value={currentTrack.release} onChange={(e) => updateTrackADSR('release', e.target.value)} style={{ width: '100%', accentColor: '#38bdf8' }} /></div>
            <div><label>Cutoff: {currentTrack.cutoff}Hz</label><input type="range" min="200" max="8000" step="100" value={currentTrack.cutoff} onChange={(e) => updateTrackADSR('cutoff', e.target.value)} style={{ width: '100%', accentColor: '#38bdf8' }} /></div>
          </div>
        </div>

        {/* Step Matrix */}
        <div style={{ backgroundColor: '#111827', padding: '1.25rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#f3f4f6', fontWeight: 'bold' }}>Tracker Step Matrix [STEP | NOTE | VEL | FX]</span>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Click step to inspect & assign commands</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '0.5rem' }}>
            {currentTrack.pattern.map((step, index) => {
              const isCurrent = activeStep === index;
              const isActive = step.active;
              const isSelected = selectedStepIndex === index;

              let bg = '#1f2937';
              if (isActive) bg = selectedTrack === 0 ? '#0284c7' : '#7c3aed';
              if (isCurrent) bg = '#f59e0b';

              const noteText = isActive ? midiToNoteName(step.midi) : '---';
              const fxText = step.fxType !== 'NONE' ? `${step.fxType}` : '';

              return (
                <button key={index} onClick={() => toggleStep(index)} style={{ height: '65px', backgroundColor: bg, color: 'white', border: isSelected ? '2px solid #38bdf8' : '1px solid #374151', borderRadius: '0.375rem', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', padding: '2px' }}>
                  <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{String(index + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isActive ? '#f8fafc' : '#475569' }}>{noteText}</span>
                  {fxText && <span style={{ fontSize: '0.65rem', color: '#facc15' }}>{fxText}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step Inspector */}
        {selectedStepIndex !== null && currentStepData && (
          <div style={{ backgroundColor: '#111827', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #38bdf8' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#38bdf8', fontWeight: 'bold' }}>Step {selectedStepIndex + 1} Command Inspector</span>
              <button onClick={() => setSelectedStepIndex(null)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.75rem', fontSize: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#9ca3af' }}>PITCH (SCALE)</label>
                <select value={currentStepData.midi} onChange={(e) => updateStepProperty('midi', parseInt(e.target.value, 10))} style={{ width: '100%', backgroundColor: '#1f2937', color: 'white', border: '1px solid #374151', padding: '0.25rem', borderRadius: '0.25rem' }}>
                  {availableMidiNotes.map(m => (<option key={m} value={m}>{midiToNoteName(m)} ({m})</option>))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#9ca3af' }}>VELOCITY (VOL)</label>
                <input type="range" min="0" max="1" step="0.05" value={currentStepData.velocity} onChange={(e) => updateStepProperty('velocity', parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#10b981' }} />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#9ca3af' }}>FX COMMAND</label>
                <select value={currentStepData.fxType} onChange={(e) => updateStepProperty('fxType', e.target.value)} style={{ width: '100%', backgroundColor: '#1f2937', color: 'white', border: '1px solid #374151', padding: '0.25rem', borderRadius: '0.25rem' }}>
                  <option value="NONE">NONE</option>
                  <option value="CUT">CUT (Filter Sweep)</option>
                  <option value="REV">REV (Reverse Sample)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', color: '#9ca3af' }}>MICRO-NUDGE (-32 to +32)</label>
                <input type="range" min="-32" max="32" step="1" value={currentStepData.nudge} onChange={(e) => updateStepProperty('nudge', parseInt(e.target.value, 10))} style={{ width: '100%', accentColor: '#f59e0b' }} />
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
