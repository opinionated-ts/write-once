# Markers and selectors

write-once recognizes language-agnostic text tokens. It does not parse or validate the host language, comment syntax, or wrapper format.

## Destination blocks

Wrap markers in comments appropriate to the file:

```md
<!-- fragment source="./content.md" -->

Generated content goes here.
<!-- /fragment -->
```

The opening `fragment` token and closing `/fragment` token must be on separate lines. Marker tokens may appear inside comment wrappers or alongside unrelated text:

```ts
// Generated API reference: fragment source="./api.md"
Old generated text.
// /fragment — keep this heading
```

By default, write-once replaces only the text between the two complete delimiter lines. The opening and closing lines, including wrapper comments and surrounding text, remain unchanged. Multiple marker tokens on one line are rejected as ambiguous.

## Read-only declarations

A marker with `name` and no `source` declares a manually maintained fragment:

```md
<!-- fragment name="intro" -->

This text is maintained by hand.
<!-- /fragment -->
```

Declarations can be nested. Names are case-sensitive, and duplicate names within one source resource are errors.

## Semantic attributes

Only three attributes affect behavior. Other attributes and surrounding text are ignored.

| Attributes                        | Behavior                                  |
| --------------------------------- | ----------------------------------------- |
| `name` without `source`           | Declare a read-only named fragment        |
| `source`                          | Generate from the whole resolved source   |
| `source` + `name`                 | Extract a named fragment from that source |
| `source` + `range`                | Extract a range from that source          |
| `name` + `range` without `source` | Invalid selector in v1                    |

A missing referenced name is an error. Named fragments are searched only in the resource named by `source`, never project-wide.

Nested read-only declarations are supported. A generated destination cannot be nested inside another generated destination because replacing the outer block would erase the inner result.

## Whole-file and named-fragment examples

Whole source:

```md
<!-- fragment source="./docs/guide.md" -->

Generated guide.
<!-- /fragment -->
```

Named source:

```md
<!-- fragment source="./docs/fragments.md" name="intro" -->

Generated introduction.
<!-- /fragment -->
```

The source file for the second example must contain a matching declaration such as `fragment name="intro"`.

## Ranges

Use the explicit attribute:

```md
<!-- fragment source="./src/example.ts" range="10:5-14:1" -->

Generated selected lines.
<!-- /fragment -->
```

Or append the range to the source reference:

```md
<!-- fragment source="./src/example.ts:10:5-14:1" -->

Generated selected lines.
<!-- /fragment -->
```

If both a source suffix and an explicit `range` attribute are present, the explicit attribute wins. The suffix is parsed from the right so Windows drive letters and colons in paths are preserved.

Range coordinates follow editor selection conventions:

- Lines and columns are 1-based.
- Columns count UTF-16 code units, matching JavaScript string offsets and common editor status bars.
- The start is inclusive and the end is exclusive.
- CRLF is treated as one line break.
- A column immediately after the last character is valid; end-of-file coordinates are valid.
- Empty ranges are allowed. Out-of-bounds coordinates and reversed ranges are errors, never silently clamped.

For example, `range="2:3-3:1"` starts at the third UTF-16 code unit on line 2 and ends at the start of line 3, including the line break between them.
