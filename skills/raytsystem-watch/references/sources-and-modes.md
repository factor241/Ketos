# Sources and modes

## Source normalization

| Source | Canonical kind | Acquisition | Visual track |
|---|---|---|---|
| YouTube, Loom, Zoom share, or direct HTTP(S) media | `url` | Destination-approved typed download | Probe result |
| Local video | `local_file` | Approved local regular file | Yes when probed |
| Local audio | `local_file` | Approved local regular file | No |
| Supplied transcript | `transcript` | Inline text or approved local text file | No |

Do not accept data URLs, pipes, devices, sockets, path-escaping symlinks, credentialed URLs, browser
cookie stores, or unsupported schemes. Normalize URL identity by dropping fragments and userinfo
and redacting sensitive query values.

## Mode mapping

| Mode | Goal | Required evidence |
|---|---|---|
| `summary` | Concise combined account | Transcript plus qualified visual inspection when visual |
| `timeline` | Chronological evidence | Timestamped cues and qualified visual evidence when visual |
| `automation` | Reproducible manual-process brief | Transcript, bounded frames, OCR, inspection, alignment |
| `frames` | Visual evidence index | Probe, frames, OCR, inspection |
| `transcript` | Speech text only | Supplied or qualified transcript evidence |

Default to `summary`. Treat steps from a screen recording as `automation`, what-happened-when as
`timeline`, and extract-the-text as `transcript` unless visual content is explicitly requested.

Never claim frame completeness. Report selection strategy, sample count, rejected frames, uncovered
intervals, and unavailable temporal precision.
