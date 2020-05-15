import { Program, Action } from '@flow-lang/framework'

import * as Html from '@flow-lang/framework/dist/dom'
import * as Audio from '@flow-lang/framework/dist/audio'
import * as Music from '@flow-lang/framework/dist/music'

// Main -----------------------------------------------------------------------
const App = Program.instrument(init, update, audio, view, listen)
const context = new AudioContext()
const root = document.querySelector('[data-flow-app]')

document.addEventListener('click', () => {
  if (context.state === 'suspended')
    context.resume()
})

App.use(Html.Event)
App.use(Audio.Event)

App.start({
  root, context, flags: {
    debug: true
  }
})

// Model ----------------------------------------------------------------------
function init (flags, time) {
  const row = (note, name, length) => ({
    note, name, steps: Array(length).fill(false)
  })

  const numSteps = 8
  const notes = [ 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4' ] 
  const bpm = 150

  return {
    currentTime: time,
    sequencer: {
      rows: notes.map(note => row(Music.Note.ntof(note), note, numSteps)),
      running: false,
      step: 0,
      stepCount: numSteps,
      stepInterval: Music.Time.sec(bpm, Music.Time.Eighth),
      tempo: bpm,
    },
    synth: {
      attack: 0,
      decay: 0.2,
      type: 'sine',
      delayTime: 1,
      delayAmount: 0.2,
      masterGain: 0
    },
  }
}

// Update ---------------------------------------------------------------------
const PLAY = 'play'
const STOP = 'stop'
const TICK = 'tick'
const ADD_STEP = 'add-step'
const RMV_STEP = 'rmv-step'
const TGL_STEP = 'tgl-step'
const RESET_STEPS = 'reset-steps'
const MUTE_TOGGLE = 'mute-toggle'
const CHANGE_WAVEFORM = 'change-waveform'
const CHANGE_DELAY = 'change-delay'

function update ({ action, payload }, model) {
  switch (action) {
    case PLAY: {
      const sequencer = { ...model.sequencer,
        running: true,
        step: model.sequencer.running 
          ? model.sequencer.step 
          : model.sequencer.step - 1
      }

      return [{ ...model, sequencer }]
    }

    case STOP: {
      const sequencer = { ...model.sequencer, running: false }

      return [{ ...model, sequencer }]
    }

    case TICK: {
      const { time } = payload
      const step = (model.sequencer.step + 1) % model.sequencer.stepCount
      const sequencer = { ...model.sequencer, step }

      return [{ ...model, currentTime: time, sequencer }]
    }

    case ADD_STEP: {
      const stepCount = model.sequencer.stepCount + 1
      const rows = model.sequencer.rows.map(row => ({
        ...row, steps: [ ...row.steps, false ]
      }))
      const sequencer = { ...model.sequencer, rows, stepCount }

      return [{ ...model, sequencer }]
    }

    case RMV_STEP: {
      const stepCount = model.sequencer.stepCount > 4
        ? model.sequencer.stepCount - 1
        : model.sequencer.stepCount
      const rows = model.sequencer.rows.map(row => ({
        ...row, steps: row.steps.slice(0, stepCount)
      }))
      const sequencer = { ...model.sequencer, rows, stepCount }

      return [{ ...model, sequencer }]
    }

    case TGL_STEP: {
      const { note, step } = payload
      const rows = model.sequencer.rows.map(row =>
        row.name == note
          ? { ...row, steps: row.steps.map((a, i) => step == i ? !a : a) }
          : row
      )
      const sequencer = { ...model.sequencer, rows }

      return [{ ...model, sequencer }]
    }

    case RESET_STEPS: {
      const rows = model.sequencer.rows.map(row =>
        ({ ...row, steps: row.steps.map(() => false)})  
      )
      const sequencer = { ...model.sequencer, rows }

      return [{ ...model, sequencer }]
    }

    case MUTE_TOGGLE: {
      return [{ ...model, synth: {
        ...model.synth, masterGain: model.synth.masterGain == 1 ? 0 : 1
      }}]
    }

    case CHANGE_WAVEFORM: {
      const { type } = payload
      const synth = { ...model.synth, type }

      return [{ ...model, synth }]
    }

    case CHANGE_DELAY: {
      const { time } = payload
      const synth = { ...model.synth, delayTime: time === 'long' ? 1 : 0.2 }

      return [{ ...model, synth }]
    }

    default: {
      console.warn(`Unhandled action: ${action}`)
      return [model] 
    }
  }
}

// Audio ----------------------------------------------------------------------
function voice  (currentTime, step, { attack, decay, type }) {
  return ({ note, steps }) => {
    const amp = steps[step] ? 0.2 : 0
    const atk = Audio.Property.linearRampToValueAtTime(
      Audio.Property.gain(amp), 
      currentTime + attack
    )
    const dcy = Audio.Property.linearRampToValueAtTime(
      Audio.Property.gain(0),
      currentTime + attack + decay
    )
  
    return Audio.Node.oscillator([
      Audio.Property.frequency(note),
      Audio.Property.type(type)
    ], [
      Audio.Node.gain([ atk, dcy ], [
        Audio.Node.ref('delay'),
        Audio.Node.ref('master'),
      ]),
    ])
  }
}

function audio ({ currentTime, sequencer, synth }) {
  return sequencer.rows
    .map(voice(currentTime, sequencer.step, synth))
    .concat([
      Audio.Keyed.delay('delay', [ Audio.Property.delayTime(synth.delayTime) ], [
        Audio.Node.gain([ Audio.Property.gain(synth.delayAmount) ], [
          Audio.Node.biquadFilter([ Audio.Property.type('lowpass'), Audio.Property.frequency(400) ], [
            Audio.Node.ref('delay'),
            Audio.Node.ref('master')
          ])
        ])
      ]),
      Audio.Keyed.gain('master', [ Audio.Property.gain(synth.masterGain) ], [
        Audio.Node.dac()
      ])
    ])
}

// View -----------------------------------------------------------------------
function combineTailwindCategories (categories) {
  return Html.Attribute.className(categories.filter(c => c !== '').join(' '))
}

function button (id, colour, attributes, children) {
  // These are all the different parts of the Tailwind css library. They're not
  // essential to the code but they make everything look pretty.
  const typography = 'text-white'
  const background = `bg-${colour}-600 hover:bg-${colour}-800`
  const borders = 'border-4 border-gray-900'
  const spacing = 'p-2 mr-4 my-2'
  const classes = combineTailwindCategories([
    typography, background, borders, spacing
  ])

  return Html.Element.button([ ...attributes, classes, Html.Attribute.id(id) ], [
    ...children
  ])
}

function sequencerDisplay (rows, highlightedColumn) {
  const layout = 'overflow-x-scroll'
  const borders = 'border-4 border-gray-900'
  const spacing = 'my-4'
  const sizing = 'w-auto'
  const classes = combineTailwindCategories([
    layout, borders, spacing, sizing
  ])

  return Html.Element.div([ classes ], [
    ...rows.map(sequencerRow(highlightedColumn))
  ])
}

function sequencerRow (highlightedColumn) {
  return ({ name, steps }) => {
    const layout = 'flex'
    const flexbox = 'items-center'
    const classes = combineTailwindCategories([
      layout, flexbox
    ])

    return Html.Element.div([ classes ], [
      Html.Element.span([ Html.Attribute.className('pl-2 pr-6 font-bold') ], [ name ]),
      ...steps.map(sequencerStep(name, highlightedColumn))
    ])
  }
}

function sequencerStep (note, highlightedColumn) {
  return (active, i) => {
    const typography = 'text-white'
    const background = `bg-gray-${active ? '900' : '600'} hover:bg-gray-800`
    const borders = 'border-4 border-gray-900'
    const spacing = 'py-4 px-6'
    const classes = combineTailwindCategories([
      typography, background, borders, spacing
    ])

    return Html.Element.div([ Html.Attribute.className(`p-2 bg-${highlightedColumn == i ? 'gray-300' : 'transparent'}`)], [
      Html.Element.button([
        Html.Attribute.dataCustom('step', `${i}`),
        Html.Attribute.dataCustom('note', note),
        classes
      ])
    ])
  }
}

function view ({ sequencer, synth }) {
  // These are all the different parts of the Tailwind css library. They're not
  // essential to the code but they make everything look pretty.
  const layout = 'container'
  const typography = 'font-mono'
  const spacing = 'mx-auto py-6 px-4'
  const classes = combineTailwindCategories([
    layout, typography, spacing
  ])

  return Html.Element.main([ classes ], [
    // Title and info ----------------------------------------------------------
    Html.Element.section([], [
      Html.Element.h1([ Html.Attribute.className('text-2xl font-bold') ], [ 'Flow.js' ])
    ]),
    // Sequencer controls ------------------------------------------------------
    Html.Element.section([], [
      button('play', 'gray', [], [ 'play' ]),
      button('stop', 'gray', [], [ 'stop' ]),
      button('add-step', 'gray', [], [ 'add step' ]),
      button('rmv-step', 'gray', [], [ 'remove step' ]),
      button('reset-steps', 'orange', [], [ 'reset steps' ]),
    ]),
    // Sequencer steps ---------------------------------------------------------
    Html.Element.section([], [
      `${sequencer.step}`,
      sequencerDisplay(sequencer.rows, sequencer.step),
    ]),
    // Synth controls ----------------------------------------------------------
    Html.Element.section([], [
      Html.Element.h2([ Html.Attribute.className('text-lg font-bold') ], [ 'Synth controls:' ]),
      button('mute-toggle', 'gray', [], [
        synth.masterGain == 1 ? 'mute' : 'unmute'
      ])
    ]),
    Html.Element.section([], [
      Html.Element.h2([ Html.Attribute.className('text-lg font-bold') ], [ 'Waveform:' ]),
      button('', 'blue', [ Html.Attribute.dataCustom('waveform', 'sine') ], [ 'sine' ]),
      button('', 'green', [ Html.Attribute.dataCustom('waveform', 'triangle') ], [ 'triangle' ]),
      button('', 'red', [ Html.Attribute.dataCustom('waveform', 'sawtooth') ], [ 'sawtooth'  ]),
      button('', 'yellow', [ Html.Attribute.dataCustom('waveform', 'square') ], [ 'square' ]),
    ]),
    Html.Element.section([], [
      Html.Element.h2([ Html.Attribute.className('text-lg font-bold') ], [ 'Delay time:' ]),
      button('delay-short', 'purple', [ Html.Attribute.dataCustom('delay', 'short') ], [ 'short' ]),
      button('delay-long', 'purple', [ Html.Attribute.dataCustom('delay', 'long') ], [ 'long' ]),
    ])
  ])
}

// Listen ---------------------------------------------------------------------
function listen (model) {
  const listeners = [
    Html.Event.click('#play', () => Action(PLAY)),
    Html.Event.click('#stop', () => Action(STOP)),
    Html.Event.click('#add-step', () => Action(ADD_STEP)),
    Html.Event.click('#rmv-step', () => Action(RMV_STEP)),
    Html.Event.click('#reset-steps', () => Action(RESET_STEPS)),
    Html.Event.click('#mute-toggle', () => Action(MUTE_TOGGLE)),
    Html.Event.click('[data-step]', ({ target }) => { 
      const { note, step } = target.dataset
      return Action(TGL_STEP, { note, step })
    }),
    Html.Event.click('[data-waveform]', ({ target }) => {
      const { waveform } = target.dataset
      return Action(CHANGE_WAVEFORM, { type: waveform })
    }),
    Html.Event.click('[data-delay]', ({ target }) => {
      const { delay } = target.dataset
      return Action(CHANGE_DELAY, { time: delay })
    }),
    Html.Event.keydown('window', ({ key }) => {
      return key == ' '
        ? Action(model.sequencer.running ? STOP : PLAY)
        : {}
    })
  ]

  if (model.sequencer.running) {
    listeners.push(
      Audio.Event.every('tick', model.sequencer.stepInterval, time => 
        Action(TICK, { time })
      )
    )
  }

  return listeners
}
