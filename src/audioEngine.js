// src/audioEngine.js
import { midiToFreq } from './scales';

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.analyser = null;
    this.isInitialized = false;
    
    // Sequencer Clock
    this.isPlaying = false;
    this.tempo = 120;
    this.currentStep = 0;
    this.timerID = null;
    this.scheduleAheadTime = 0.1;
    this.lookaheadInterval = 25;
    this.nextNoteTime = 0.0;
    
    // Multi-Track Architecture
    this.tracks = [
      { 
        id: 0, 
        name: 'Track 1 (Lead Synth)', 
        type: 'synth',
        oscType: 'square',
        sampleBuffer: null,
        sampleName: null,
        attack: 0.015,
        decay: 0.15,
        sustain: 0.4,
        release: 0.25,
        cutoff: 2500,
        pattern: Array(16).fill(null).map(() => ({ 
          active: false, 
          midi: 60, 
          nudge: 0,
          velocity: 1.0,
          fxType: 'NONE',
          fxValue: 0 
        })) 
      },
      { 
        id: 1, 
        name: 'Track 2 (Bass / Drum)', 
        type: 'synth',
        oscType: 'sawtooth',
        sampleBuffer: null,
        sampleName: null,
        attack: 0.01,
        decay: 0.1,
        sustain: 0.2,
        release: 0.15,
        cutoff: 1200,
        pattern: Array(16).fill(null).map(() => ({ 
          active: false, 
          midi: 48, 
          nudge: 0,
          velocity: 1.0,
          fxType: 'NONE',
          fxValue: 0 
        })) 
      }
    ];

    // Auto-Resume Suspended Context on Visibility Recovery
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
      });
    }
  }

  init() {
    if (this.isInitialized && this.audioCtx) {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.audioCtx.currentTime);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    this.isInitialized = true;
  }

  async loadSample(trackIndex, file) {
    if (!this.isInitialized) this.init();
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      
      if (this.tracks[trackIndex]) {
        this.tracks[trackIndex].sampleBuffer = decodedBuffer;
        this.tracks[trackIndex].sampleName = file.name;
        this.tracks[trackIndex].type = 'sample';
      }
      return decodedBuffer;
    } catch (err) {
      console.error("Error decoding audio sample:", err);
      throw err;
    }
  }

  playSynthTone(track, stepData, time = null) {
    if (!this.isInitialized) this.init();

    const now = time !== null ? time : this.audioCtx.currentTime;
    const freq = midiToFreq(stepData.midi);

    const osc = this.audioCtx.createOscillator();
    const filter = this.audioCtx.createBiquadFilter();
    const noteGain = this.audioCtx.createGain();

    osc.type = track.oscType;
    osc.frequency.setValueAtTime(freq, now);

    let cutoffFreq = track.cutoff || 2500;
    if (stepData.fxType === 'CUT' && stepData.fxValue > 0) {
      cutoffFreq = stepData.fxValue;
    }
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffFreq, now);

    const vel = stepData.velocity !== undefined ? stepData.velocity : 1.0;
    const peakLevel = 0.5 * vel;
    const sustainLevel = peakLevel * (track.sustain || 0.4);

    const att = Math.max(0.005, track.attack || 0.015);
    const dec = Math.max(0.01, track.decay || 0.15);
    const rel = Math.max(0.01, track.release || 0.25);

    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(peakLevel, now + att);
    noteGain.gain.linearRampToValueAtTime(sustainLevel, now + att + dec);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + att + dec + rel);

    osc.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + att + dec + rel);
  }

  playSampleBuffer(track, stepData, time = null) {
    if (!this.isInitialized || !track.sampleBuffer) return;

    const now = time !== null ? time : this.audioCtx.currentTime;
    let buffer = track.sampleBuffer;

    if (stepData.fxType === 'REV') {
      buffer = this.getReversedBuffer(track.sampleBuffer);
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    
    const pitchRatio = Math.pow(2, (stepData.midi - 60) / 12);
    source.playbackRate.setValueAtTime(pitchRatio, now);

    const noteGain = this.audioCtx.createGain();
    const vel = stepData.velocity !== undefined ? stepData.velocity : 1.0;
    noteGain.gain.setValueAtTime(0.8 * vel, now);

    source.connect(noteGain);
    noteGain.connect(this.masterGain);

    source.start(now);
  }

  getReversedBuffer(originalBuffer) {
    if (this._lastReversedOriginal === originalBuffer && this._lastReversedResult) {
      return this._lastReversedResult;
    }
    const numChannels = originalBuffer.numberOfChannels;
    const reversedBuffer = this.audioCtx.createBuffer(numChannels, originalBuffer.length, originalBuffer.sampleRate);
    
    for (let c = 0; c < numChannels; c++) {
      const srcData = originalBuffer.getChannelData(c);
      const destData = reversedBuffer.getChannelData(c);
      for (let i = 0; i < originalBuffer.length; i++) {
        destData[i] = srcData[originalBuffer.length - 1 - i];
      }
    }

    this._lastReversedOriginal = originalBuffer;
    this._lastReversedResult = reversedBuffer;
    return reversedBuffer;
  }

  setMasterVolume(value) {
    if (this.masterGain && this.audioCtx) {
      this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, value)), this.audioCtx.currentTime);
    }
  }

  setTempo(bpm) {
    this.tempo = bpm;
  }

  setTrackADSR(trackIndex, attack, decay, sustain, release, cutoff) {
    if (this.tracks[trackIndex]) {
      this.tracks[trackIndex].attack = attack;
      this.tracks[trackIndex].decay = decay;
      this.tracks[trackIndex].sustain = sustain;
      this.tracks[trackIndex].release = release;
      if (cutoff !== undefined) this.tracks[trackIndex].cutoff = cutoff;
    }
  }

  setStepData(trackIndex, stepIndex, stepObject) {
    if (this.tracks[trackIndex]) {
      this.tracks[trackIndex].pattern[stepIndex] = { ...stepObject };
    }
  }

  nextNote() {
    const secondsPerBeat = 60.0 / this.tempo;
    const secondsPer16th = secondsPerBeat / 4;
    this.nextNoteTime += secondsPer16th;
    this.currentStep = (this.currentStep + 1) % 16;
  }

  schedule() {
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      const secondsPerBeat = 60.0 / this.tempo;
      const secondsPer16th = secondsPerBeat / 4;
      const tickDuration = secondsPer16th / 32;

      for (const track of this.tracks) {
        const step = track.pattern[this.currentStep];
        if (step && step.active) {
          const nudgeOffset = (step.nudge || 0) * tickDuration;
          const scheduledTime = Math.max(this.audioCtx.currentTime, this.nextNoteTime + nudgeOffset);

          if (track.type === 'sample' && track.sampleBuffer) {
            this.playSampleBuffer(track, step, scheduledTime);
          } else {
            this.playSynthTone(track, step, scheduledTime);
          }
        }
      }

      this.nextNote();
    }
  }

  startSequencer(onStepCallback) {
    if (!this.isInitialized) this.init();
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.audioCtx.currentTime + 0.05;

    this.timerID = setInterval(() => {
      this.schedule();
      if (onStepCallback) onStepCallback(this.currentStep);
    }, this.lookaheadInterval);
  }

  stopSequencer() {
    this.isPlaying = false;
    clearInterval(this.timerID);
    this.timerID = null;
    this.currentStep = 0;
  }

  async renderMasterWav() {
    if (!this.isInitialized) this.init();

    const sampleRate = this.audioCtx.sampleRate;
    const secondsPerBeat = 60.0 / this.tempo;
    const totalDuration = secondsPerBeat * 4;
    
    const offlineCtx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
    
    const offlineGain = offlineCtx.createGain();
    offlineGain.gain.setValueAtTime(0.8, 0);
    offlineGain.connect(offlineCtx.destination);

    this.tracks.forEach(track => {
      track.pattern.forEach((step, stepIndex) => {
        if (step.active) {
          const stepTime = (secondsPerBeat / 4) * stepIndex;
          
          if (track.type === 'synth') {
            const osc = offlineCtx.createOscillator();
            const noteGain = offlineCtx.createGain();
            osc.type = track.oscType;
            osc.frequency.setValueAtTime(midiToFreq(step.midi), stepTime);
            
            noteGain.gain.setValueAtTime(0, stepTime);
            noteGain.gain.linearRampToValueAtTime(0.5 * step.velocity, stepTime + 0.015);
            noteGain.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.25);
            
            osc.connect(noteGain);
            noteGain.connect(offlineGain);
            
            osc.start(stepTime);
            osc.stop(stepTime + 0.25);
          }
        }
      });
    });

    const renderedBuffer = await offlineCtx.startRendering();
    return this.audioBufferToWavBlob(renderedBuffer);
  }

  audioBufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new DataView(new ArrayBuffer(length));
    let channels = [];
    let sampleRate = buffer.sampleRate;
    let offset = 0;
    let pos = 0;

    function writeString(str) {
      for (let i = 0; i < str.length; i++) {
        out.setUint8(pos++, str.charCodeAt(i));
      }
    }

    writeString('RIFF');
    out.setUint32(pos, length - 8, true); pos += 4;
    writeString('WAVE');
    writeString('fmt ');
    out.setUint32(pos, 16, true); pos += 4;
    out.setUint16(pos, 1, true); pos += 2;
    out.setUint16(pos, numOfChan, true); pos += 2;
    out.setUint32(pos, sampleRate, true); pos += 4;
    out.setUint32(pos, sampleRate * numOfChan * 2, true); pos += 4;
    out.setUint16(pos, numOfChan * 2, true); pos += 2;
    out.setUint16(pos, 16, true); pos += 2;
    writeString('data');
    out.setUint32(pos, length - pos - 4, true); pos += 4;

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (offset < buffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        out.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([out.buffer], { type: 'audio/wav' });
  }
}

export const audioEngine = new AudioEngine();
