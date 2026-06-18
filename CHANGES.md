# CHANGES

## Feedback received

During the poster session, we were told that the project already felt like a complete proof of concept. The main suggestions were to make installation easier and to improve how the assistant keeps recent context between sessions.

Voice-to-text was also discussed as a possible future feature. Another suggestion was to show more of the actual interaction with the agent on the poster.

## Changes made

- Simplified the installation and setup flow so the project can be run from the submitted ZIP with standard npm commands.
- Added yesterday's memory file to the agent context automatically when available, so recent context is kept without the user repeating it.
- Did small code cleanup while preparing the final version.

## Not implemented

- Voice-to-text was not added. We decided it would add too much setup complexity through extra dependencies and platform-specific issues, while offering only limited benefit for the final submission. The current Telegram and TUI interfaces are enough to demonstrate the proof of concept.
- We did not substantially change the poster to show more of the direct interaction with the agent. During the poster session, most viewers were more interested in the technical architecture, runtime behavior, memory, and safety mechanisms, so we kept the poster focused on those aspects.
