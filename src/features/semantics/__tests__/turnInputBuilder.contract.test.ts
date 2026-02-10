import { describe, expect, it } from 'vitest'
import { buildTurnInput } from '../turnInputBuilder.js'

describe('TurnInputBuilder contract', () => {
  it('keeps mode/slash mapping stable', () => {
    const cases = [
      {
        name: 'normal plain',
        rawText: 'hello',
        mode: 'normal' as const,
        planPath: null,
      },
      {
        name: 'plan plain',
        rawText: 'plan this',
        mode: 'plan' as const,
        planPath: '/tmp/plan.md',
      },
      {
        name: 'normal /init',
        rawText: '/init',
        mode: 'normal' as const,
        planPath: null,
      },
      {
        name: 'acceptEdits /permissions',
        rawText: '/permissions',
        mode: 'acceptEdits' as const,
        planPath: null,
      },
    ]

    const actual = cases.map((c) => {
      const out = buildTurnInput(c)
      return {
        name: c.name,
        displayText: out.displayText,
        modelUserTextPrefix: out.modelUserText.slice(0, 40),
        semanticBlockCount: out.semanticBlocks.length,
        injectionKinds: out.injections.map((i) => i.kind),
        slash: out.slash,
      }
    })

    expect(actual).toMatchInlineSnapshot(`
      [
        {
          "displayText": "hello",
          "injectionKinds": [],
          "modelUserTextPrefix": "hello",
          "name": "normal plain",
          "semanticBlockCount": 0,
          "slash": {
            "commandName": null,
            "raw": "hello",
            "resolved": "pass_through",
          },
        },
        {
          "displayText": "plan this",
          "injectionKinds": [
            "mode",
          ],
          "modelUserTextPrefix": "plan this",
          "name": "plan plain",
          "semanticBlockCount": 1,
          "slash": {
            "commandName": null,
            "raw": "plan this",
            "resolved": "pass_through",
          },
        },
        {
          "displayText": "/init",
          "injectionKinds": [],
          "modelUserTextPrefix": "Please analyze this codebase and create ",
          "name": "normal /init",
          "semanticBlockCount": 0,
          "slash": {
            "commandName": "/init",
            "raw": "/init",
            "resolved": "model_mapped",
          },
        },
        {
          "displayText": "/permissions",
          "injectionKinds": [],
          "modelUserTextPrefix": "/permissions",
          "name": "acceptEdits /permissions",
          "semanticBlockCount": 0,
          "slash": {
            "commandName": "/permissions",
            "raw": "/permissions",
            "resolved": "pass_through",
          },
        },
      ]
    `)
  })
})
