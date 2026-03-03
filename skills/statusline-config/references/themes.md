# Statusline Theme Definitions

## Token → Color Mapping

Each theme defines 12 semantic tokens. TrueColor themes use `\033[38;2;R;G;Bm`.
ANSI themes use standard 16-color codes. TrueColor tokens aim for WCAG AA >= 4.5:1 (best-effort) against their respective assumed dark backgrounds. Decorative tokens (`C_SEP`, `C_MUTED`, `C_COST`) may fall below 4.5:1 intentionally.

### ansi-default (ANSI 16 — safe fallback)

Assumed background: terminal default. Contrast: best-effort (depends on user's terminal theme).

| Token        | ANSI Code  | Escape       |
| ------------ | ---------- | ------------ |
| `C_CWD`      | Blue       | `\033[34m`   |
| `C_BRANCH`   | Magenta    | `\033[35m`   |
| `C_MODEL`    | Cyan       | `\033[36m`   |
| `C_CTX_OK`   | Green      | `\033[32m`   |
| `C_CTX_WARN` | Yellow     | `\033[33m`   |
| `C_CTX_BAD`  | Red        | `\033[31m`   |
| `C_COST`     | Dim        | `\033[2m`    |
| `C_ALERT`    | Red + Bold | `\033[1;31m` |
| `C_SEP`      | Dim        | `\033[2m`    |
| `C_MUTED`    | Dim        | `\033[2m`    |
| `C_TEXT`     | (none)     | (empty)      |
| `C_RESET`    | Reset      | `\033[0m`    |

### catppuccin-mocha (TrueColor — recommended)

Background: `#1E1E2E`. Source: [catppuccin.com](https://catppuccin.com/)

| Token        | Color Name | Hex       | RGB           | Escape                     |
| ------------ | ---------- | --------- | ------------- | -------------------------- |
| `C_CWD`      | Sapphire   | `#74C7EC` | 116, 199, 236 | `\033[38;2;116;199;236m`   |
| `C_BRANCH`   | Mauve      | `#CBA6F7` | 203, 166, 247 | `\033[38;2;203;166;247m`   |
| `C_MODEL`    | Teal       | `#94E2D5` | 148, 226, 213 | `\033[38;2;148;226;213m`   |
| `C_CTX_OK`   | Green      | `#A6E3A1` | 166, 227, 161 | `\033[38;2;166;227;161m`   |
| `C_CTX_WARN` | Yellow     | `#F9E2AF` | 249, 226, 175 | `\033[38;2;249;226;175m`   |
| `C_CTX_BAD`  | Red        | `#F38BA8` | 243, 139, 168 | `\033[38;2;243;139;168m`   |
| `C_COST`     | Subtext 0  | `#A6ADC8` | 166, 173, 200 | `\033[38;2;166;173;200m`   |
| `C_ALERT`    | Peach+Bold | `#FAB387` | 250, 179, 135 | `\033[1;38;2;250;179;135m` |
| `C_SEP`      | Overlay 1  | `#7F849C` | 127, 132, 156 | `\033[38;2;127;132;156m`   |
| `C_MUTED`    | Overlay 2  | `#9399B2` | 147, 153, 178 | `\033[38;2;147;153;178m`   |
| `C_TEXT`     | Text       | `#CDD6F4` | 205, 214, 244 | `\033[38;2;205;214;244m`   |
| `C_RESET`    | —          | —         | —             | `\033[0m`                  |

### dracula (TrueColor)

Background: `#282A36`. Source: [draculatheme.com](https://draculatheme.com/contribute)

| Token        | Color Name  | Hex       | RGB           | Escape                     |
| ------------ | ----------- | --------- | ------------- | -------------------------- |
| `C_CWD`      | Cyan        | `#8BE9FD` | 139, 233, 253 | `\033[38;2;139;233;253m`   |
| `C_BRANCH`   | Purple      | `#BD93F9` | 189, 147, 249 | `\033[38;2;189;147;249m`   |
| `C_MODEL`    | Green       | `#50FA7B` | 80, 250, 123  | `\033[38;2;80;250;123m`    |
| `C_CTX_OK`   | Green       | `#50FA7B` | 80, 250, 123  | `\033[38;2;80;250;123m`    |
| `C_CTX_WARN` | Yellow      | `#F1FA8C` | 241, 250, 140 | `\033[38;2;241;250;140m`   |
| `C_CTX_BAD`  | Red         | `#FF5555` | 255, 85, 85   | `\033[38;2;255;85;85m`     |
| `C_COST`     | Comment     | `#6272A4` | 98, 114, 164  | `\033[38;2;98;114;164m`    |
| `C_ALERT`    | Orange+Bold | `#FFB86C` | 255, 184, 108 | `\033[1;38;2;255;184;108m` |
| `C_SEP`      | Comment     | `#6272A4` | 98, 114, 164  | `\033[38;2;98;114;164m`    |
| `C_MUTED`    | Comment     | `#6272A4` | 98, 114, 164  | `\033[38;2;98;114;164m`    |
| `C_TEXT`     | Foreground  | `#F8F8F2` | 248, 248, 242 | `\033[38;2;248;248;242m`   |
| `C_RESET`    | —           | —         | —             | `\033[0m`                  |

### nord (TrueColor)

Background: `#2E3440`. Source: [nordtheme.com](https://www.nordtheme.com/docs/colors-and-palettes)

| Token        | Color Name  | Hex       | RGB           | Escape                     |
| ------------ | ----------- | --------- | ------------- | -------------------------- |
| `C_CWD`      | Frost 8     | `#88C0D0` | 136, 192, 208 | `\033[38;2;136;192;208m`   |
| `C_BRANCH`   | Aurora 15   | `#B48EAD` | 180, 142, 173 | `\033[38;2;180;142;173m`   |
| `C_MODEL`    | Frost 7     | `#8FBCBB` | 143, 188, 187 | `\033[38;2;143;188;187m`   |
| `C_CTX_OK`   | Aurora 14   | `#A3BE8C` | 163, 190, 140 | `\033[38;2;163;190;140m`   |
| `C_CTX_WARN` | Aurora 13   | `#EBCB8B` | 235, 203, 139 | `\033[38;2;235;203;139m`   |
| `C_CTX_BAD`  | Aurora 11   | `#BF616A` | 191, 97, 106  | `\033[38;2;191;97;106m`    |
| `C_COST`     | Snow 4      | `#D8DEE9` | 216, 222, 233 | `\033[38;2;216;222;233m`   |
| `C_ALERT`    | Aurora 12+B | `#D08770` | 208, 135, 112 | `\033[1;38;2;208;135;112m` |
| `C_SEP`      | Polar 3     | `#4C566A` | 76, 86, 106   | `\033[38;2;76;86;106m`     |
| `C_MUTED`    | Snow 4      | `#D8DEE9` | 216, 222, 233 | `\033[38;2;216;222;233m`   |
| `C_TEXT`     | Snow 4      | `#D8DEE9` | 216, 222, 233 | `\033[38;2;216;222;233m`   |
| `C_RESET`    | —           | —         | —             | `\033[0m`                  |

## WCAG Notes

- TrueColor themes assume dark terminal backgrounds (~`#1E1E2E` to `#2E3440`)
- `ansi-default` contrast depends on user's terminal theme — marked **best-effort**
- `C_SEP`, `C_MUTED`, and `C_COST` may fall below 4.5:1 intentionally (decorative/secondary)
- `C_ALERT` uses bold to provide non-color differentiation from `C_CTX_BAD`

## NO_COLOR Convention

When `NO_COLOR` env var is set (any value), all `C_*` tokens become empty strings.
See [no-color.org](https://no-color.org/) for the standard.
