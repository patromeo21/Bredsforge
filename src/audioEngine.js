// src/audioEngine.js
import { midiToFreq } from './scales';

class AudioEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.analyser = null;
    this.isInitialized = false;
    
    this.isPlaying = false;
    this.tempo = 120;
    this.currentStep = 0;
    this.totalSteps = 32; 
    this.timerID = null;
    this.scheduleAheadTime = 0.1;
    this.lookaheadInterval = 25;
    this.nextNoteTime = 0.0;
    
    this.tracks = [
      { 
        id: 0, name: 'TRK 1 (LEAD)', type: 'synth', oscType: 'square', filterMode: 'lowpass',
        sampleBuffer: null, sampleName: null, sampleStartTrim: 0.0, sampleEndTrim: 1.0,
        attack: 0.015, decay: 0.15, sustain: 0.4, release: 0.25, cutoff: 2500,
        pattern: Array(32).fill(null).map(() => ({ active: false, midi: 60, inst: 1, velocity: 0.8, nudge: 0, fxType: 'NONE', fxValue: 2500 })) 
      },
      { 
        id: 1, name: 'TRK 2 (BASS)', type: 'synth', oscType: 'sawtooth', filterMode: 'lowpass',
        sampleBuffer: null, sampleName: null, sampleStartTrim: 0.0, sampleEndTrim: 1.0,
        attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.15, cutoff: 1200,
        pattern: Array(32).fill(null).map(() => ({ active: false, midi: 48, inst: 2, velocity: 0.8, nudge: 0, fxType: 'NONE', fxValue: 1200 })) 
      },
      { 
        id: 2, name: 'TRK 3 (DRUM)', type: 'synth', oscType: 'triangle', filterMode: 'highpass',
        sampleBuffer: null, sampleName: null, sampleStartTrim: 0.0, sampleEndTrim: 1.0,
        attack: 0.005, decay: 0.08, sustain: 0.1, release: 0.1, cutoff: 400,
        pattern: Array(32).fill(null).map(() => ({ active: false, midi: 36, inst: 3, velocity: 0.9, nudge: 0, fxType: 'NONE', fxValue: 400 })) 
      },
      { 
        id: 3, name: 'TRK 4 (PAD)', type: 'synth', oscType: 'sine', filterMode: 'lowpass',
        sampleBuffer: null, sampleName: null, sampleStartTrim: 0.0, sampleEndTrim: 1.0,
        attack: 0.05, decay: 0.3, sustain: 0.6, release: 0.5, cutoff: 1800,
        pattern: Array(32).fill(null).map(() => ({ active: false, midi: 72, inst: 4, velocity: 0.7, nudge: 0, fxType: 'NONE', fxValue: 1800 })) 
      }
    ];
  }

  init() {
    if (this.isInitialized && this.audioCtx) {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextClass({ latencyHint: 'interactive' });
    
    this.masterGain = this.audioCtx.createGain();
    this.masterGain.gain.setValueAtTime(0.8, this.audioCtx.currentTime);

    this.masterCompressor = this.audioCtx.createDynamicsCompressor();
    this.masterCompressor.threshold.setValueAtTime(-6, this.audioCtx.currentTime);
    this.masterCompressor.ratio.setValueAtTime(4, this.audioCtx.currentTime);

    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    
    this.masterGain.connect(this.masterCompressor);
    this.masterCompressor.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);
    this.isInitialized = true;
  }

  async loadSample(trackIndex, file) {
    if (!this.isInitialized) this.init();
    const arrayBuffer = await file.arrayBuffer();
    const decodedBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
    if (this.tracks[trackIndex]) {
      this.tracks[trackIndex].sampleBuffer = decodedBuffer;
      this.tracks[trackIndex].sampleName = file.name;
      this.tracks[trackIndex].type = 'sample';
    }
    return decodedBuffer;
  }

  playSynthTone(track, stepData, time = null) {
    if (!this.isInitialized) this.init();
    const now = time !== null ? time : this.audioCtx.currentTime;
    const freq = midiToFreq(stepData.midi);

    const osc = this.audioCtx.createOscillator();
    const filter = this.audioCtx.createBiquadFilter();
    const noteGain = this.audioCtx.createGain();

    osc.type = track.oscType || 'square';
    osc.frequency.setValueAtTime(freq, now);
    filter.type = track.filterMode || 'lowpass';
    filter.frequency.setValueAtTime(stepData.fxType === 'CUT' ? stepData.fxValue : (track.cutoff || 2500), now);

    const vel = stepData.velocity !== undefined ? stepData.velocity : 0.8;
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(0.5 * vel, now + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  playSampleBuffer(track, stepData, time = null) {
    if (!this.isInitialized || !track.sampleBuffer) return;
    const now = time !== null ? time : this.audioCtx.currentTime;
    const source = this.audioCtx.createBufferSource();
    source.buffer = track.sampleBuffer;
    
    const filter = this.audioCtx.createBiquadFilter();
    filter.type = track.filterMode || 'lowpass';
    filter.frequency.setValueAtTime(track.cutoff || 2500, now);

    const noteGain = this.audioCtx.createGain();
    noteGain.gain.setValueAtTime(0.8 * (stepData.velocity || 0.8), now);

    source.connect(filter);
    filter.connect(noteGain);
    noteGain.connect(this.masterGain);

    source.start(now, track.sampleStartTrim * track.sampleBuffer.duration);
  }

  setTempo(bpm) { this.tempo = bpm; }
  setRowResolution(res) { this.totalSteps = res; }
  setTrackADSR(idx, att, dec, sus, rel, cutoff, mode) {
    if (this.tracks[idx]) {
      Object.assign(this.tracks[idx], { attack: att, decay: dec, sustain: sus, release: rel, cutoff, filterMode: mode });
    }
  }
  setTrackSampleTrims(idx, start, end) {
    if (this.tracks[idx]) {
      this.tracks[idx].sampleStartTrim = start;
      this.tracks[idx].sampleEndTrim = end;
    }
  }
  setStepData(trackIdx, stepIdx, obj) {
    if (this.tracks[trackIdx]) this.tracks[trackIdx].pattern[stepIdx] = { ...obj };
  }

  nextNote() {
    const spb = 60.0 / this.tempo;
    this.nextNoteTime += (spb / 4) / (this.totalSteps / 16);
    this.currentStep = (this.currentStep + 1) % this.totalSteps;
  }

  schedule() {
    while (this.nextNoteTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      for (const track of this.tracks) {
        const step = track.pattern[this.currentStep];
        if (step && step.active) {
          const t = Math.max(this.audioCtx.currentTime, this.nextNoteTime);
          if (track.type === 'sample' && track.sampleBuffer) this.playSampleBuffer(track, step, t);
          else this.playSynthTone(track, step, t);
        }
      }
      this.nextNote();
    }
  }

  startSequencer(cb) {
    if (!this.isInitialized) this.init();
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.audioCtx.currentTime + 0.05;
    this.timerID = setInterval(() => {
      this.schedule();
      if (cb) cb(this.currentStep);
    }, this.lookaheadInterval);
  }

  stopSequencer() {
    this.isPlaying = false;
    clearInterval(this.timerID);
    this.timerID = null;
    this.currentStep = 0;
  }
}

exports = audioEngine; // Or export default audioEngine (or leave as class export depending on setup)
// In our module:
export const audioEngine = new AudioEngine();
