/**
 * Help › About (2026-09-24): the owner's story, the name `SGVue` even in dev, and the version,
 * on both the macOS panel and the Windows / Linux message box. `src/main/about.ts`.
 */
import { describe, expect, it } from 'vitest'
import {
  ABOUT_NAME,
  ABOUT_STORY,
  aboutBoxOptions,
  aboutPanelOptions,
  graphicsLine
} from '../../src/main/about'

describe('the About box', () => {
  it('tells the story verbatim', () => {
    expect(ABOUT_STORY).toBe(
      'SGVue was made by Yong Yen, an architectural professional who wanted a faster way to look inside IFC models — to open a federation, walk its storeys and grids, and get straight answers about what is in it, without risking a single change to the files. Claude, by Anthropic, was the builder: together they turned a finished design into a desktop app, one careful step at a time. Everything stays on this machine; the model is only ever read, never written.'
    )
    expect(ABOUT_STORY.endsWith('the model is only ever read, never written.')).toBe(true)
  })

  it('names the app SGVue, whatever app.name says', () => {
    expect(ABOUT_NAME).toBe('SGVue')
  })

  it('macOS: the panel carries the name, the version and the story as its credits', () => {
    expect(aboutPanelOptions('1.0.0')).toEqual({
      applicationName: 'SGVue',
      applicationVersion: '1.0.0',
      version: '1.0.0',
      credits: ABOUT_STORY
    })
  })

  it('Windows and Linux: a message box with the name and version over the story', () => {
    expect(aboutBoxOptions('1.0.0')).toEqual({
      type: 'info',
      title: 'About SGVue',
      message: 'SGVue 1.0.0',
      detail: ABOUT_STORY,
      buttons: ['OK'],
      noLink: true
    })
  })

  it('Windows and Linux: ends with the adapter drawing, when it is known (2026-09-25)', () => {
    expect(graphicsLine('NVIDIA GeForce RTX 3070 Ti')).toBe('Graphics: NVIDIA GeForce RTX 3070 Ti')
    const box = aboutBoxOptions('1.0.3', 'NVIDIA GeForce RTX 3070 Ti')
    expect(box.detail).toBe(`${ABOUT_STORY}\n\nGraphics: NVIDIA GeForce RTX 3070 Ti`)
    expect(box.message).toBe('SGVue 1.0.3')
    expect(aboutBoxOptions('1.0.3', null).detail).toBe(ABOUT_STORY)
  })
})
