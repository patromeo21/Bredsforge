// src/App.jsx - Segregated Bento Dashboard + M8 Retro-Digital Tracker UI
import React, { useState, useEffect, useRef } from 'react';
import { audioEngine } from './audioEngine';
import { SCALES, NOTE_NAMES, midiToNoteName } from './scales';

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState(null);
  const [selectedTrack, setSelectedTrack] = useState(0);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  const [rowResolution, setRowResolution] = useState(32);
  const [selectedScale, setSelectedScale] = useState('Minor');
  const [rootNoteMidi, setRootNoteMidi] = useState(60);

  const [tracks, setTracks] = useState(audioEngine.tracks);

  const waveformCanvasRef = useRef(null);
  const visualizerCanvasRef = useRef(null);

  const currentTrack = tracks[selectedTrack];
  const selectedStepData = selectedRowIndex !== null ? currentTrack.pattern[selectedRowIndex] : null;

  // QWERTY & Arrow Hotkeys
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['input', 'select', 'textarea'].includes(document.activeElement.tagName.toLowerCase())) return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.max(0, (prev !== null ? prev : 0) - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedRowIndex(prev => Math.min(rowResolution - 1, (prev !== null ? prev : 0) + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setSelectedTrack(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setSelectedTrack(prev => Math.min(tracks.length - 1, prev + 1));
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedRowIndex !== null) {
          updateStepProperty('active', false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRowIndex, selectedTrack, rowResolution, tracks]);

  // Render Sample Waveform with Trim Markers
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

      ctx.fillStyle = '#030712';
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

      const startX = width * (currentTrack.sampleStartTrim || 0);
      const endX = width * (currentTrack.sampleEndTrim || 1);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(0, 0, startX, height);
      ctx.fillRect(endX, 0, width - endX, height);

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, 0); ctx.lineTo(startX, height);
      ctx.moveTo(endX, 0); ctx.lineTo(endX, height);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#475569';
      ctx.font = '11px monospace';
      ctx.fillText('Synth Oscillator Mode (Import WAV)', 12, height / 2 + 4);
    }
  }, [selectedTrack, tracks]);

  // Render 60FPS Spectrum Analyzer
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

      const barWidth = (canvas.width / bufferLength) * 2.2;
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

  const selectCell = (trackIndex, rowIndex) => {
    setSelectedTrack(trackIndex);
    setSelectedRowIndex(rowIndex);
  };

  const toggleStepActive = (trackIndex, rowIndex) => {
    const targetTrack = tracks[trackIndex];
    const existing = targetTrack.pattern[rowIndex];
    const updatedStep = { ...existing, active: !existing.active };

    audioEngine.setStepData(trackIndex, rowIndex, updatedStep);

    const updatedTracks = [...tracks];
    updatedTracks[trackIndex].pattern[rowIndex] = updatedStep;
    setTracks(updatedTracks);
    setSelectedTrack(trackIndex);
    setSelectedRowIndex(rowIndex);

    if (updatedStep.active) {
      if (targetTrack.type === 'sample' && targetTrack.sampleBuffer) {
        audioEngine.playSampleBuffer(targetTrack, updatedStep);
      } else {
        audioEngine.playSynthTone(targetTrack, updatedStep);
      }
    }
  };

  const updateStepProperty = (key, value) => {
    if (selectedRowIndex === null) return;
    const existing = currentTrack.pattern[selectedRowIndex];
    const updatedStep = { ...existing, [key]: value };

    audioEngine.setStepData(selectedTrack, selectedRowIndex, updatedStep);
    const updatedTracks = [...tracks];
    updatedTracks[selectedTrack].pattern[selectedRowIndex] = updatedStep;
    setTracks(updatedTracks);
  };

  const handleRowResolutionChange = (res) => {
    const newRes = parseInt(res, 10);
    setRowResolution(newRes);
    audioEngine.setRowResolution(newRes);
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
      audioEngine.startSequencer((step) => setActiveStep(step));
      setIsPlaying(true);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#030712', color: '#f8fafc', padding: '1rem', fontFamily: 'system-ui, sans-serif' }}>
      
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #1f2937', paddingBottom: '0.6rem' }}>
        <div>
          <h1 style={{ fontSize: '1.3rem', fontWeight: '800', color: '#38bdf8', margin: 0 }}>BredForge <span style={{ color: '#10b981', fontSize: '0.9rem' }}>M8 PRO</span></h1>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Segregated Bento Studio + Retro-Digital 8-Bit Tracker</span>
        </div>
        <div>
          <button onClick={handleTogglePlay} style={{ backgroundColor: isPlaying ? '#ef4444' : '#10b981', color: 'white', border: 'none', padding: '0.4rem 1.1rem', borderRadius: '0.375rem', fontWeight: 'bold', cursor: 'pointer' }}>{isPlaying ? '■ STOP' : '▶ PLAY'}</button>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1rem', maxWidth: '1280px', margin: '0 auto' }}>
        
        {/* LEFT: M8 Tracker Display */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111827', padding: '0.6rem 0.9rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#38bdf8' }}>PATTERN MATRIX</span>
            <select value={rowResolution} onChange={(e) => handleRowResolutionChange(e.target.value)} style={{ backgroundColor: '#1f2937', color: '#f8fafc', border: '1px solid #374151', padding: '0.2rem', borderRadius: '0.25rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
              <option value={16}>16 Rows</option>
              <option value={32}>32 Rows (Roll)</option>
            </select>
          </div>

          <div style={{ backgroundColor: '#030712', padding: '0.75rem', borderRadius: '0.5rem', border: '2px solid #1f2937', maxHeight: '460px', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '45px repeat(4, 1fr)', gap: '0.5rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.4rem', marginBottom: '0.4rem', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 'bold' }}>
              <span style={{ color: '#475569' }}>ROW</span>
              {tracks.map(t => <span key={t.id} style={{ color: selectedTrack === t.id ? '#38bdf8' : '#64748b' }}>{t.name}</span>)}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {Array(rowResolution).fill(null).map((_, rowIndex) => {
                const isCurrentRow = activeStep === rowIndex;
                const rowHex = String(rowIndex.toString(16)).padStart(2, '0').toUpperCase();
                return (
                  <div key={rowIndex} style={{ display: 'grid', gridTemplateColumns: '45px repeat(4, 1fr)', gap: '0.5rem', backgroundColor: isCurrentRow ? '#1e1b4b' : 'transparent', borderLeft: isCurrentRow ? '3px solid #f59e0b' : '3px solid transparent', padding: '0.15rem 0' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: isCurrentRow ? '#f59e0b' : '#475569', alignSelf: 'center' }}>{rowHex}</span>
                    {tracks.map((track) => {
                      const step = track.pattern[rowIndex];
                      const isSelectedCell = selectedTrack === track.id && selectedRowIndex === rowIndex;
                      return (
                        <div key={track.id} onClick={() => selectCell(track.id, rowIndex)} onDoubleClick={() => toggleStepActive(track.id, rowIndex)} style={{ display: 'flex', justifyContent: 'space-between', backgroundColor: isSelectedCell ? '#0284c7' : (step.active ? '#0b0f19' : '#030712'), color: step.active ? '#38bdf8' : '#334155', padding: '0.25rem 0.4rem', borderRadius: '0.2rem', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer' }}>
                          <span style={{ fontWeight: 'bold', color: step.active ? '#f8fafc' : '#334155' }}>{step.active ? midiToNoteName(step.midi) : '---'}</span>
                          <span style={{ color: step.active ? '#c084fc' : '#334155' }}>{step.active ? String(step.inst || 1).padStart(2, '0') : '--'}</span>
                          <span style={{ color: step.active ? '#10b981' : '#334155' }}>{step.active ? `V${Math.round((step.velocity || 0.8) * 99)}` : '---'}</span>
                          <span style={{ color: step.active ? '#facc15' : '#334155' }}>{step.active && step.fxType === 'CUT' ? `C${step.fxValue}` : '------'}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: Bento Sound Sculpting Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ backgroundColor: '#111827', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 'bold', display: 'block', marginBottom: '0.4rem' }}>ACTIVE CHANNEL</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
              {tracks.map((t) => (
                <button key={t.id} onClick={() => setSelectedTrack(t.id)} style={{ padding: '0.4rem', backgroundColor: selectedTrack === t.id ? '#0284c7' : '#1f2937', color: 'white', border: 'none', borderRadius: '0.25rem', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>{t.name}</button>
              ))}
            </div>
          </div>

          <div style={{ backgroundColor: '#111827', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#38bdf8', fontWeight: 'bold' }}>SAMPLE CHOPPER</span>
              <label style={{ backgroundColor: '#0284c7', color: 'white', padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.65rem', cursor: 'pointer' }}>📁 Import<input type="file" accept="audio/*" onChange={handleFileUpload} style={{ display: 'none' }} /></label>
            </div>
            <canvas ref={waveformCanvasRef} width={300} height={60} style={{ width: '100%', borderRadius: '0.25rem', border: '1px solid #334155' }} />
          </div>

          <div style={{ backgroundColor: '#111827', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #1f2937' }}>
            <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 'bold', display: 'block', marginBottom: '0.4rem' }}>SPECTRUM ANALYZER</span>
            <canvas ref={visualizerCanvasRef} width={300} height={55} style={{ width: '100%', borderRadius: '0.25rem', border: '1px solid #334155' }} />
          </div>
        </div>

      </main>
    </div>
  );
}
