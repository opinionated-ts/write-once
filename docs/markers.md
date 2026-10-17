# Markers and selectors

Markers tell write-once which text to reuse and where to place it. They are language-agnostic: write-once reads the marker tokens as plain text and does not parse the surrounding language or comment syntax.

## Destination blocks

Wrap markers in comments appropriate to the file:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./content.md" -->
Generated content goes here.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

The opening `fragment` token and closing `/fragment` token must be on separate lines. Marker tokens may appear inside comment wrappers or alongside unrelated text:

<!-- write-once-ignore-start -->

```ts
// Generated API reference: fragment source="./api.md"
Old generated text.
// /fragment — keep this heading
```

<!-- write-once-ignore-end -->

By default, write-once replaces only the text between the two complete delimiter lines. The opening and closing lines, including wrapper comments and surrounding text, remain unchanged. Multiple marker tokens on one line are rejected as ambiguous.

## Suppressing fragments

Use language-agnostic suppression tokens to keep intentionally invalid examples in a document without disabling validation for the rest of the file. The tokens are recognized as plain text; their surrounding comment syntax is not interpreted.

Ignore the next fragment block:

<!-- write-once-ignore-start -->

```md
<!-- write-once-ignore-next -->
<!-- fragment range="not-a-valid-range" -->
This intentionally invalid example is left untouched.
<!-- /fragment -->

<!-- fragment source="./content.md" -->
This fragment is still processed normally.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Ignore all fragments within a region:

```ts
// write-once-ignore-start
fragment range="not-a-valid-range"
/fragment

<!-- fragment source="./missing.md" -->
<!-- /fragment -->
<!-- write-once-ignore-end -->
```

The start and end tokens may use different host-language comment wrappers. Only the directive words matter. Suppressed content remains unchanged; its fragment markers and declarations are excluded from scanning, resolution, extraction, and generation. Fragments outside the suppressed scope continue to be processed normally.

Region directives cannot be nested. An end directive must match a start directive, and an ignore-next directive must have a following fragment marker. Malformed or unmatched directives produce a diagnostic rather than silently suppressing unintended content.

## Read-only declarations

A marker with `name` and no `source` declares a manually maintained fragment:

<!-- write-once-ignore-start -->

```md
<!-- fragment name="intro" -->
This text is maintained by hand.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

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

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./docs/guide.md" -->
Generated guide.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Named source:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./docs/fragments.md" name="intro" -->
Generated introduction.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

<!-- write-once-ignore-start -->

The source file for the second example must contain a matching declaration such as `fragment name="intro"`.

<!-- write-once-ignore-end -->

## Ranges

Use the explicit attribute:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./src/example.ts" range="10:5-14:1" -->
Generated selected lines.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

Or append the range to the source reference:

<!-- write-once-ignore-start -->

```md
<!-- fragment source="./src/example.ts:10:5-14:1" -->
Generated selected lines.
<!-- /fragment -->
```

<!-- write-once-ignore-end -->

If both a source suffix and an explicit `range` attribute are present, the explicit attribute wins. The suffix is parsed from the right so Windows drive letters and colons in paths are preserved.

Range coordinates follow editor selection conventions:

- Lines and columns are 1-based.
- Columns count UTF-16 code units, matching JavaScript string offsets and common editor status bars.
- The start is inclusive and the end is exclusive.
- CRLF is treated as one line break.
- A column immediately after the last character is valid; end-of-file coordinates are valid.
- Empty ranges are allowed. Out-of-bounds coordinates and reversed ranges are errors, never silently clamped.

For example, `range="2:3-3:1"` starts at the third UTF-16 code unit on line 2 and ends at the start of line 3, including the line break between them.

## Related guides

**Recommended next:**

- [Configuration](configuration.md)
- [CLI workflow and diagnostics](cli.md)

**Other guides:**

- [Public TypeScript API](api.md)
- [README and quick start](../README.md)
