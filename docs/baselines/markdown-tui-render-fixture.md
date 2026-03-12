# Markdown TUI Rendering Fixture

This file is intentionally dense. It is a visual fixture for comparing Markdown rendering behavior across TUI implementations.

## 1. Headings

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

## 2. Paragraphs, Breaks, and Escapes

This is a normal paragraph with punctuation, numbers (12345), and symbols (!@#$%^&*).

This line ends with two spaces for a hard break.  
This should be on a new visual line if hard breaks are supported.

This line uses a trailing backslash for a hard break.\
This should also be on a new visual line.

Escaped markdown characters: \*literal asterisk\*, \_literal underscore\_, \`literal backtick\`.

## 3. Emphasis and Inline Syntax

- *Italic text*
- **Bold text**
- ***Bold and italic***
- ~~Strikethrough text~~
- `inline code`
- Mixed: **bold with `inline code` inside**
- Mixed: *italic with [inline link](https://example.com)*

## 4. Links and Auto Links

- Inline link: [OpenAI](https://openai.com)
- Inline link with title: [Vite](https://vite.dev "Vite website")
- Auto link: <https://example.org/docs/path?query=a&lang=en>
- Email link: <mailto:test@example.org>
- Reference link: [Repository docs][docs-ref]

[docs-ref]: https://github.com

## 5. Unordered Lists

- Level 1 item A
- Level 1 item B
  - Level 2 item B.1
  - Level 2 item B.2
    - Level 3 item B.2.a
    - Level 3 item B.2.b
- Level 1 item C with very long text to test wrapping behavior in narrow terminals and verify that continuation indentation is visually stable across re-renders.

## 6. Ordered Lists

1. First item
2. Second item
3. Third item

3. Numbered list starting at 3
4. Next item
5. Next item

1. Mixed list root
   - Nested bullet under ordered list
   - Another nested bullet
2. Second mixed root item

## 7. Task Lists (Checkboxes)

- [x] Completed item
- [ ] Pending item
- [ ] TypeScript/JavaScript
- [x] TypeScript/JavaScript
- [ ] Very long pending item to test marker alignment and width stability when selection state changes in interactive UIs.

## 8. Blockquotes

> Simple quote line.
>
> Multi-line quote paragraph.
>
> - Quoted bullet A
> - Quoted bullet B
>   - Quoted nested bullet
>
> `Quoted inline code` and **quoted bold text**.

## 9. Code Blocks

```ts
interface User {
  id: string
  name: string
  roles: string[]
}

const formatUser = (u: User): string => `${u.name} (${u.id})`
```

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "hello markdown fixture"
ls -la
```

```json
{
  "name": "markdown-fixture",
  "version": "1.0.0",
  "features": ["lists", "tables", "code", "quotes"]
}
```

```diff
- old line
+ new line
 unchanged context
```

Fenced block without language:

```
plain text block
line 2
line 3
```

Indented code block:

    const indented = true
    console.log('indented code block')

## 10. Horizontal Rules

---

Text between rules.

***

More text.

___

## 11. Tables

| Column A | Column B | Column C |
| --- | ---: | :---: |
| left | right | center |
| short | 123 | yes |
| very long cell content that should wrap or clip based on renderer behavior | 999999 | maybe |

## 12. Images

Image syntax (some TUIs may not render the image and only show alt text/url):

![Sample image](https://picsum.photos/320/120)

## 13. HTML in Markdown (Often Unsupported in TUI)

<details>
  <summary>Click to expand (if raw HTML is supported)</summary>
  <p>Inline HTML paragraph inside details.</p>
</details>

<div>
  <strong>Raw HTML strong tag</strong>
</div>

## 14. Footnotes (Extension-Dependent)

Here is a sentence with a footnote reference.[^1]

Another footnote here.[^long-note]

[^1]: This is footnote one.
[^long-note]: This is a longer footnote to test extension support in markdown parsers.

## 15. Inline HTML Entities

- `&lt;div&gt;` should display as `<div>` if entity decoding is applied.
- `&amp;` should display as `&`.

## 16. Nested Stress Case

> 1. Quoted ordered item one
> 2. Quoted ordered item two
>    - Nested bullet in quoted ordered list
>      ```ts
>      const inside = 'nested fence in quote'
>      ```
> 3. End quoted list

## 17. Wrap Stress Line

Long unbroken token:

`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`

Long sentence with punctuation and links to test soft-wrap boundaries in narrow terminal widths: please check how this line wraps when viewport width changes from 120 to 80 to 60, including whether indentation stays stable for continuation lines and whether links like https://example.com/very/long/path/for/wrapping/tests break gracefully.

## 18. Final Checklist

Use this checklist during screenshot comparison:

- Are headings visually distinct by level?
- Are `inline code` and fenced code styles clearly different?
- Do nested lists keep consistent indentation?
- Are task list markers aligned and stable in width?
- Are tables readable or gracefully degraded?
- Are links styled and distinguishable from normal text?
- Are blockquotes visually separated from normal paragraphs?
- Does raw HTML render, escape, or get stripped?
- Do footnotes render as references and notes, or as plain text?
- Is line wrapping stable without flicker when content updates?
